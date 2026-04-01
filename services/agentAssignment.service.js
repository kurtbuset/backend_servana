const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");
const { cacheManager, default: redisClient } = require("../helpers/redisClient");
const { USER_PRESENCE_STATUS, CHAT_STATUS } = require("../constants/statuses");

class AgentAssignmentService {
  constructor() {
    this.REDIS_KEY_PREFIX = "round_robin:dept:";
    this.REDIS_TTL = 86400;
    this.MAX_WORKLOAD = 5;
  }

  // --- Redis helpers ---

  async getLastAssignedAgent(deptId) {
    try {
      const val = await redisClient.get(`${this.REDIS_KEY_PREFIX}${deptId}`);
      return val ? parseInt(val, 10) : null;
    } catch { return null; }
  }

  async setLastAssignedAgent(deptId, agentId) {
    try {
      await redisClient.setex(`${this.REDIS_KEY_PREFIX}${deptId}`, this.REDIS_TTL, String(agentId));
    } catch (e) {
      console.error("❌ Error setting last assigned agent:", e.message);
    }
  }

  // --- Core helpers ---

  async getAvailableAgents(deptId) {
    try {
      const presences = await cacheManager.getAllUserPresence();
      return Object.entries(presences)
        .filter(([_, p]) =>
          p.userPresence === USER_PRESENCE_STATUS.ACCEPTING_CHATS &&
          Array.isArray(p.deptIds) && p.deptIds.includes(deptId)
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
      data?.forEach(({ sys_user_id }) => { if (sys_user_id in workloads) workloads[sys_user_id]++; });
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
      const minWorkload = Math.min(...availableAgents.map((id) => workloadMap[id]));
      const candidates = availableAgents.filter((id) => workloadMap[id] === minWorkload);

      let selected;
      if (candidates.length === 1) {
        selected = candidates[0];
      } else {
        const lastAssigned = await this.getLastAssignedAgent(deptId);
        const lastIdx = candidates.indexOf(lastAssigned);
        selected = candidates[(lastIdx + 1) % candidates.length];
      }

      await this.setLastAssignedAgent(deptId, selected);
      console.log(`🔄 Round-robin → agent ${selected} for dept ${deptId} (workload: ${minWorkload})`);
      return selected;
    } catch (e) {
      console.error("❌ selectNextAgent:", e.message);
      // Fallback: simple round-robin
      const last = await this.getLastAssignedAgent(deptId);
      const idx = availableAgents.indexOf(last);
      const selected = availableAgents[(idx + 1) % availableAgents.length];
      await this.setLastAssignedAgent(deptId, selected);
      return selected;
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
    console.log('yeah!')
    await cacheService.cacheChatGroup(chatGroupId, data);
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
    console.log(`📥 Chat ${chatGroupId} queued`);
    return data;
  }

  // --- Orchestration ---

  async autoAssignChatGroup(chatGroupId, deptId) {
    console.log(`🔍 Auto-assigning chat ${chatGroupId} in dept ${deptId}`);
    const available = await this.getAvailableAgents(deptId);

    if (!available.length) {
      await this.setChatGroupQueued(chatGroupId);
      return { assigned: false, status: "queued", message: "No available agents" };
    }

    const agentId = await this.selectNextAgent(available, deptId);
    const chatGroup = await this.assignChatGroupToAgent(chatGroupId, agentId);
    return { assigned: true, status: "active", agentId, chatGroup };
  }

  async assignQueuedChatsToAgent(agentId) {
    console.log(`🔍 Draining queue for agent ${agentId}`);

    const { data: depts, error: deptErr } = await supabase
      .from("sys_user_department")
      .select("dept_id")
      .eq("sys_user_id", agentId);

    if (deptErr || !depts?.length) return [];

    const presence = await cacheManager.getUserPresence(agentId);
    if (presence?.userPresence !== USER_PRESENCE_STATUS.ACCEPTING_CHATS) return [];

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
      const result = await this.autoAssignChatGroup(chat.chat_group_id, chat.dept_id);
      if (result.assigned && result.agentId === agentId) {
        assigned.push({ chat_group_id: chat.chat_group_id, dept_id: chat.dept_id, client_id: chat.client_id, status: "active" });
      }
    }

    console.log(`✅ Assigned ${assigned.length} queued chats to agent ${agentId}`);
    return assigned;
  }
}

module.exports = new AgentAssignmentService();