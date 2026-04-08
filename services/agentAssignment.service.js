const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");
const { cacheManager } = require("../helpers/redisClient");
const { USER_PRESENCE_STATUS, CHAT_STATUS } = require("../constants/statuses");

class AgentAssignmentService {
  constructor() {
    this.REDIS_KEY_PREFIX = "round_robin:dept:";
    this.REDIS_TTL = 86400;
    this.MAX_WORKLOAD = 5;
  }

  // --- Redis helpers ---

  /**
   * Atomically increment and return a round-robin counter for a department.
   * INCR is a single atomic Redis command — no read-modify-write race condition.
   */
  async getRoundRobinCounter(deptId) {
    try {
      if (!cacheManager.isConnected || !cacheManager.client) return null;
      const key = `${this.REDIS_KEY_PREFIX}${deptId}`;
      const count = await cacheManager.client.incr(key);
      await cacheManager.client.expire(key, this.REDIS_TTL);
      return count;
    } catch {
      return null;
    }
  }

  // --- Core helpers ---

  async getAvailableAgents(deptId) {
    try {
      const presences = await cacheManager.getAllUserPresence();
      return Object.entries(presences)
        .filter(
          ([_, p]) =>
            p.userPresence === USER_PRESENCE_STATUS.ACCEPTING_CHATS &&
            Array.isArray(p.deptIds) &&
            p.deptIds.includes(deptId),
        )
        .map(([id]) => parseInt(id, 10));
    } catch (e) {
      console.error("❌ getAvailableAgents:", e.message);
      return [];
    }
  }

  async getAgentWorkloads(agentIds) {
    if (!agentIds?.length) return {};
    const workloads = Object.fromEntries(agentIds.map((id) => [id, 0]));
    try {
      const { data, error } = await supabase
        .from("chat_group")
        .select("sys_user_id")
        .in("sys_user_id", agentIds)
        .eq("status", CHAT_STATUS.ACTIVE);
      if (error) throw error;
      data?.forEach(({ sys_user_id }) => {
        if (sys_user_id in workloads) workloads[sys_user_id]++;
      });
    } catch (e) {
      console.error("❌ getAgentWorkloads:", e.message);
    }
    return workloads;
  }

  async selectNextAgent(availableAgents, deptId) {
    if (!availableAgents?.length) return null;
    if (availableAgents.length === 1) return availableAgents[0];

    try {
      const workloadMap = await this.getAgentWorkloads(availableAgents);
      const minWorkload = Math.min(
        ...availableAgents.map((id) => workloadMap[id]),
      );
      const candidates = availableAgents.filter(
        (id) => workloadMap[id] === minWorkload,
      );

      let selected;
      if (candidates.length === 1) {
        selected = candidates[0];
      } else {
        // Atomic INCR — no race condition between concurrent assignment calls
        const counter = await this.getRoundRobinCounter(deptId);
        const idx = counter !== null ? (counter - 1) % candidates.length : 0;
        selected = candidates[idx];
      }

      console.log(
        `🔄 Round-robin → agent ${selected} for dept ${deptId} (workload: ${minWorkload})`,
      );
      return selected;
    } catch (e) {
      console.error("❌ selectNextAgent:", e.message);
      // Fallback: pick first available agent
      return availableAgents[0];
    }
  }

  // --- Assignment actions ---

  async assignChatGroupToAgent(chatGroupId, agentId, { requiredStatus } = {}) {
    let query = supabase
      .from("chat_group")
      .update({ sys_user_id: agentId, status: CHAT_STATUS.ACTIVE })
      .eq("chat_group_id", chatGroupId)
      .is("sys_user_id", null);

    if (requiredStatus) {
      query = query.eq("status", requiredStatus);
    }

    const { data, error } = await query.select().single();

    if (error) throw error;
    if (!data) throw new Error("Chat group not found or already assigned");

    // Best-effort: fill in the pending transfer log entry
    const { error: logErr } = await supabase
      .from("chat_transfer_log")
      .update({ to_agent_id: agentId })
      .eq("chat_group_id", chatGroupId)
      .is("to_agent_id", null)
      .order("transferred_at", { ascending: false })
      .limit(1);

    if (logErr) console.error("⚠️ Transfer log update failed:", logErr.message);

    // Invalidate agent's chat groups cache (new chat assigned)
    await cacheService.invalidateUserChatGroups(agentId);

    console.log(`✅ Chat ${chatGroupId} → agent ${agentId}`);
    return data;
  }

  async setChatGroupQueued(chatGroupId) {
    const { data, error } = await supabase
      .from("chat_group")
      .update({ status: CHAT_STATUS.QUEUED })
      .eq("chat_group_id", chatGroupId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // --- Orchestration ---

  async autoAssignChatGroup(chatGroupId, deptId) {
    const available = await this.getAvailableAgents(deptId);

    if (!available.length) {
      await this.setChatGroupQueued(chatGroupId);
      return {
        assigned: false,
        status: "queued",
        message: "No available agents",
      };
    }

    const agentId = await this.selectNextAgent(available, deptId);
    const chatGroup = await this.assignChatGroupToAgent(chatGroupId, agentId);
    return { assigned: true, status: "active", agentId, chatGroup };
  }

  async assignQueuedChatsToAgent(agentId) {

    const { data: depts, error: deptErr } = await supabase
      .from("sys_user_department")
      .select("dept_id")
      .eq("sys_user_id", agentId);

    if (deptErr || !depts?.length) return [];

    const presence = await cacheManager.getUserPresence(agentId);
    if (presence?.userPresence !== USER_PRESENCE_STATUS.ACCEPTING_CHATS)
      return [];

    const workloads = await this.getAgentWorkloads([agentId]);
    const slots = Math.max(0, this.MAX_WORKLOAD - (workloads[agentId] ?? 0));
    if (!slots) return [];

    const deptIds = depts.map((d) => d.dept_id);
    const { data: queued, error: qErr } = await supabase
      .from("chat_group")
      .select("chat_group_id, dept_id, client_id, created_at")
      .in("dept_id", deptIds)
      .eq("status", CHAT_STATUS.QUEUED)
      .is("sys_user_id", null)
      .order("created_at", { ascending: true });

    if (qErr || !queued?.length) return [];

    const assigned = [];
    for (const chat of queued) {
      if (assigned.length >= slots) break;
      const result = await this.autoAssignChatGroup(
        chat.chat_group_id,
        chat.dept_id,
      );
      if (result.assigned && result.agentId === agentId) {
        assigned.push({
          chat_group_id: chat.chat_group_id,
          dept_id: chat.dept_id,
          client_id: chat.client_id,
          status: "active",
        });
      }
    }

    console.log(
      `✅ Assigned ${assigned.length} queued chats to agent ${agentId}`,
    );
    return assigned;
  }
}

module.exports = new AgentAssignmentService();
