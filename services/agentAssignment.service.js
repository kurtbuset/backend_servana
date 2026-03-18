const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");
const redisClient = require("../helpers/redisClient");

/**
 * Agent Assignment Service
 * Handles round-robin assignment of chat groups to available agents
 */
class AgentAssignmentService {
  constructor() {
    this.REDIS_KEY_PREFIX = "round_robin:dept:";
    this.REDIS_TTL = 86400; // 24 hours TTL to prevent memory leak
  }

  /**
   * Get last assigned agent for a department from Redis
   * @param {number} deptId - Department ID
   * @returns {Promise<number|null>} Last assigned agent ID or null
   */
  async getLastAssignedAgent(deptId) {
    try {
      const key = `${this.REDIS_KEY_PREFIX}${deptId}`;
      const agentId = await redisClient.get(key);
      return agentId ? parseInt(agentId, 10) : null;
    } catch (error) {
      console.error(
        `❌ Error getting last assigned agent from Redis:`, 
        error.message,
      );
      return null;
    }
  }

  /**
   * Set last assigned agent for a department in Redis
   * @param {number} deptId - Department ID
   * @param {number} agentId - Agent user ID
   */
  async setLastAssignedAgent(deptId, agentId) {
    try {
      const key = `${this.REDIS_KEY_PREFIX}${deptId}`;
      await redisClient.setex(key, this.REDIS_TTL, agentId.toString());
    } catch (error) {
      console.error(
        `❌ Error setting last assigned agent in Redis:`,
        error.message,
      );
      // Don't throw - round-robin will still work, just less optimal
    }
  }

  /**
   * Find available agents in a department (agent_status = 'accepting_chats')
   * @param {number} deptId - Department ID
   * @returns {Promise<Array>} Array of available agent user IDs
   */
  async getAvailableAgents(deptId) {
    try {
      const { data: agents, error } = await supabase
        .from("sys_user_department")
        .select(
          `
          sys_user_id,
          sys_user:sys_user!inner(
            sys_user_id,
            agent_status,
            sys_user_is_active,
            role:role!inner(role_name)
          )
        `,
        )
        .eq("dept_id", deptId)
        .eq("sys_user.agent_status", "accepting_chats")
        .eq("sys_user.sys_user_is_active", true)
        .eq("sys_user.role.role_name", "Agent");

      if (error) {
        console.error("❌ Error fetching available agents:", error);
        return [];
      }

      // Extract sys_user_id from the nested structure
      const availableAgents = (agents || [])
        .map((a) => a.sys_user?.sys_user_id)
        .filter((id) => id !== null && id !== undefined);

      console.log(
        `📋 Found ${availableAgents.length} available agents in dept ${deptId}`,
      );
      return availableAgents;
    } catch (error) {
      console.error("❌ Error in getAvailableAgents:", error.message);
      return [];
    }
  }

  /**
   * Get agent workload for multiple agents (batch query)
   * @param {Array<number>} agentIds - Array of agent user IDs
   * @returns {Promise<Object>} Object mapping agentId to workload count
   */
  async getAgentWorkloads(agentIds) {
    try {
      if (!agentIds || agentIds.length === 0) {
        return {};
      }

      // Single query to get all workloads
      const { data, error } = await supabase
        .from("chat_group")
        .select("sys_user_id")
        .in("sys_user_id", agentIds)
        .eq("status", "active");

      if (error) throw error;

      // Count workloads in memory
      const workloads = {};
      agentIds.forEach((id) => (workloads[id] = 0));

      if (data) {
        data.forEach((row) => {
          if (workloads[row.sys_user_id] !== undefined) {
            workloads[row.sys_user_id]++;
          }
        });
      }

      return workloads;
    } catch (error) {
      console.error("❌ Error getting agent workloads:", error.message);
      // Return zero workload for all agents on error
      const workloads = {};
      agentIds.forEach((id) => (workloads[id] = 0));
      return workloads;
    }
  }

  /**
   * Get agent workload (number of active chats)
   * @param {number} userId - Agent user ID
   * @returns {Promise<number>} Number of active chats
   */
  async getAgentWorkload(userId) {
    try {
      const { count, error } = await supabase
        .from("chat_group")
        .select("chat_group_id", { count: "exact", head: true })
        .eq("sys_user_id", userId)
        .eq("status", "active");

      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error(
        `❌ Error getting workload for agent ${userId}:`,
        error.message,
      );
      return 0;
    }
  }

  /**
   * Select next agent using round-robin with workload balancing
   * @param {Array} availableAgents - Array of available agent IDs
   * @param {number} deptId - Department ID
   * @returns {Promise<number|null>} Selected agent ID or null
   */
  async selectNextAgent(availableAgents, deptId) {
    if (!availableAgents || availableAgents.length === 0) {
      return null;
    }

    if (availableAgents.length === 1) {
      return availableAgents[0];
    }

    try {
      // Get workload for all available agents in a single query
      const workloadMap = await this.getAgentWorkloads(availableAgents);

      // Build agent workload array
      const agentWorkloads = availableAgents.map((agentId) => ({
        agentId,
        workload: workloadMap[agentId] || 0,
      }));

      // Sort by workload (ascending) to balance load
      agentWorkloads.sort((a, b) => a.workload - b.workload);

      // Get agents with minimum workload
      const minWorkload = agentWorkloads[0].workload;
      const leastLoadedAgents = agentWorkloads
        .filter((a) => a.workload === minWorkload)
        .map((a) => a.agentId);

      // If multiple agents have same workload, use round-robin
      if (leastLoadedAgents.length === 1) {
        await this.setLastAssignedAgent(deptId, leastLoadedAgents[0]);
        return leastLoadedAgents[0];
      }

      // Round-robin among least loaded agents
      const lastAssigned = await this.getLastAssignedAgent(deptId);
      let selectedAgent;

      if (!lastAssigned || !leastLoadedAgents.includes(lastAssigned)) {
        // No previous assignment or last agent not in list, pick first
        selectedAgent = leastLoadedAgents[0];
      } else {
        // Find next agent after last assigned
        const lastIndex = leastLoadedAgents.indexOf(lastAssigned);
        const nextIndex = (lastIndex + 1) % leastLoadedAgents.length;
        selectedAgent = leastLoadedAgents[nextIndex];
      }

      // Update last assigned agent for this department
      await this.setLastAssignedAgent(deptId, selectedAgent);

      console.log(
        `🔄 Round-robin selected agent ${selectedAgent} for dept ${deptId} (workload: ${minWorkload})`,
      );
      return selectedAgent;
    } catch (error) {
      console.error("❌ Error in selectNextAgent:", error.message);
      // Fallback to simple round-robin
      const lastAssigned = await this.getLastAssignedAgent(deptId);
      const lastIndex = lastAssigned
        ? availableAgents.indexOf(lastAssigned)
        : -1;
      const nextIndex = (lastIndex + 1) % availableAgents.length;
      const selectedAgent = availableAgents[nextIndex];
      await this.setLastAssignedAgent(deptId, selectedAgent);
      return selectedAgent;
    }
  }

  /**
   * Assign chat group to an agent
   * @param {number} chatGroupId - Chat group ID
   * @param {number} agentId - Agent user ID
   * @returns {Promise<Object>} Updated chat group
   */
  async assignChatGroupToAgent(chatGroupId, agentId) {
    try {
      const { data, error } = await supabase
        .from("chat_group")
        .update({
          sys_user_id: agentId,
          status: "active",
        })
        .eq("chat_group_id", chatGroupId)
        .is("sys_user_id", null) // Only assign if not already assigned
        .select()
        .single();

      if (error) throw error;

      if (!data) {
        throw new Error("Chat group not found or already assigned");
      }

      // Invalidate cache
      await cacheService.invalidateChatGroup(chatGroupId);

      console.log(`✅ Assigned chat group ${chatGroupId} to agent ${agentId}`);
      return data;
    } catch (error) {
      console.error(
        `❌ Error assigning chat group ${chatGroupId}:`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Set chat group status to queued (no available agent)
   * @param {number} chatGroupId - Chat group ID
   * @returns {Promise<Object>} Updated chat group
   */
  async setChatGroupQueued(chatGroupId) {
    try {
      const { data, error } = await supabase
        .from("chat_group")
        .update({ status: "queued" })
        .eq("chat_group_id", chatGroupId)
        .select()
        .single();

      if (error) throw error;

      console.log(`📥 Chat group ${chatGroupId} set to queued status`);
      return data;
    } catch (error) {
      console.error(
        `❌ Error setting chat group ${chatGroupId} to queued:`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Auto-assign chat group to available agent or queue it
   * @param {number} chatGroupId - Chat group ID
   * @param {number} deptId - Department ID
   * @returns {Promise<Object>} Assignment result
   */
  async autoAssignChatGroup(chatGroupId, deptId) {
    try {
      console.log(
        `🔍 Auto-assigning chat group ${chatGroupId} in dept ${deptId}`,
      );

      // Get available agents
      const availableAgents = await this.getAvailableAgents(deptId);

      if (availableAgents.length === 0) {
        // No available agents, set to queued
        await this.setChatGroupQueued(chatGroupId);
        return {
          assigned: false,
          status: "queued",
          message: "No available agents, chat group queued",
        };
      }

      // Select next agent using round-robin
      const selectedAgent = await this.selectNextAgent(availableAgents, deptId);

      if (!selectedAgent) {
        await this.setChatGroupQueued(chatGroupId);
        return {
          assigned: false,
          status: "queued",
          message: "Failed to select agent, chat group queued",
        };
      }

      // Assign to selected agent
      const chatGroup = await this.assignChatGroupToAgent(
        chatGroupId,
        selectedAgent,
      );

      return {
        assigned: true,
        status: "active",
        agentId: selectedAgent,
        chatGroup,
        message: `Chat group assigned to agent ${selectedAgent}`,
      };
    } catch (error) {
      console.error(`❌ Error in autoAssignChatGroup:`, error.message);
      throw error;
    }
  }

  /**
   * Check for queued chats and assign to newly available agent using round-robin
   * Called when an agent logs in or changes status to accepting_chats
   * @param {number} agentId - Agent user ID
   * @returns {Promise<Array>} Array of assigned chat groups
   */
  async assignQueuedChatsToAgent(agentId) {
    try {
      console.log(
        `🔍 Checking queued chats for newly available agent ${agentId}`,
      );

      // Get agent's departments
      const { data: agentDepts, error: deptError } = await supabase
        .from("sys_user_department")
        .select("dept_id")
        .eq("sys_user_id", agentId);

      if (deptError || !agentDepts || agentDepts.length === 0) {
        console.log(`⚠️ Agent ${agentId} has no departments`);
        return [];
      }

      const deptIds = agentDepts.map((d) => d.dept_id);

      // Check agent status ONCE before processing
      const { data: agentData, error: agentError } = await supabase
        .from("sys_user")
        .select("agent_status")
        .eq("sys_user_id", agentId)
        .single();

      if (agentError || agentData?.agent_status !== "accepting_chats") {
        console.log(`⚠️ Agent ${agentId} is not accepting chats`);
        return [];
      }

      // Check agent's current workload ONCE
      const currentWorkload = await this.getAgentWorkload(agentId);
      const maxWorkload = 5;
      const availableSlots = Math.max(0, maxWorkload - currentWorkload);

      if (availableSlots === 0) {
        console.log(
          `⚠️ Agent ${agentId} already at max workload (${currentWorkload})`,
        );
        return [];
      }

      // Get queued chat groups in agent's departments (oldest first)
      const { data: queuedChats, error: queueError } = await supabase
        .from("chat_group")
        .select("chat_group_id, dept_id, client_id, created_at")
        .in("dept_id", deptIds)
        .eq("status", "queued")
        .is("sys_user_id", null)
        .order("created_at", { ascending: true }); // Oldest first

      if (queueError || !queuedChats || queuedChats.length === 0) {
        // console.log(`📭 No queued chats found for agent ${agentId}`);
        return [];
      }

      console.log(
        `📬 Found ${queuedChats.length} queued chats in agent ${agentId}'s departments`,
      );

      // Assign chats using round-robin across all available agents
      const assignedChats = [];

      for (const chat of queuedChats) {
        // For each queued chat, use round-robin to select the best agent
        const result = await this.autoAssignChatGroup(
          chat.chat_group_id,
          chat.dept_id,
        );

        if (result.assigned && result.agentId === agentId) {
          // This chat was assigned to the current agent
          assignedChats.push({
            chat_group_id: chat.chat_group_id,
            dept_id: chat.dept_id,
            client_id: chat.client_id,
            status: "active",
          });

          console.log(
            `✅ Assigned chat ${chat.chat_group_id} to agent ${agentId} via round-robin`,
          );

          // Stop if agent reached their available slots
          if (assignedChats.length >= availableSlots) {
            console.log(
              `⚠️ Agent ${agentId} reached max available slots (${availableSlots})`,
            );
            break;
          }
        } else if (result.assigned) {
          console.log(
            `📋 Chat ${chat.chat_group_id} assigned to agent ${result.agentId} via round-robin`,
          );
        }
      }

      console.log(
        `✅ Assigned ${assignedChats.length} queued chats to agent ${agentId} using round-robin`,
      );
      return assignedChats;
    } catch (error) {
      console.error(`❌ Error in assignQueuedChatsToAgent:`, error.message);
      return [];
    }
  }
}

module.exports = new AgentAssignmentService();
