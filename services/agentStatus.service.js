const profileService = require("./profile.service");
const agentAssignmentService = require("./agentAssignment.service");

/**
 * Agent Status Service
 * Handles agent status updates and related operations
 */
class AgentStatusService {
  /**
   * Update agent status and handle side effects
   * @param {number} userId - Agent user ID
   * @param {string} status - New agent status
   * @param {Object} io - Socket.IO instance (optional)
   * @returns {Promise<Object>} Result with assigned chats if applicable
   */
  async updateAgentStatus(userId, status) {
    // Validate status
    const validStatuses = ["accepting_chats", "not_accepting_chats", "offline"];
    if (!status || !validStatuses.includes(status)) {
      throw new Error(
        "Invalid agent_status. Must be one of: accepting_chats, not_accepting_chats, offline",
      );
    }

    // Update status in database
    await profileService.updateAgentStatus(userId, status);

    // If agent is now accepting chats, assign queued chats
    let assignedChats = [];
    if (status === "accepting_chats") {
      try {
        assignedChats = await agentAssignmentService.assignQueuedChatsToAgent(
          userId,
        );
        if (assignedChats.length > 0) {
          console.log(
            `✅ Assigned ${assignedChats.length} queued chats to agent ${userId}`,
          );
        }
      } catch (error) {
        console.error("❌ Error assigning queued chats:", error.message);
        // Don't throw - status update was successful
      }
    }

    return {
      userId,
      agent_status: status,
      assignedChats,
    };
  }

  /**
   * Broadcast agent status change via Socket.IO to agents in same departments
   * More efficient than broadcasting to all clients
   * @param {Object} io - Socket.IO instance
   * @param {number} userId - Agent user ID
   * @param {string} status - New agent status
   */
  async broadcastStatusChange(io, userId, status) {
    if (!io) return;

    const supabase = require("../helpers/supabaseClient");

    try {
      // Get the agent's departments
      const { data: userDepartments, error } = await supabase
        .from("sys_user_department")
        .select("dept_id")
        .eq("sys_user_id", userId);

      if (error) {
        console.error(
          "❌ Error fetching user departments for broadcast:",
          error,
        );
        return;
      }

      const departmentIds = userDepartments?.map((d) => d.dept_id) || [];

      if (departmentIds.length === 0) {
        console.log("⚠️ Agent has no departments, skipping status broadcast");
        return;
      }

      // Broadcast to each department room
      const statusData = {
        userId,
        agent_status: status,
        timestamp: new Date(),
      };

      departmentIds.forEach((deptId) => {
        io.to(`department_${deptId}`).emit("agentStatusChanged", statusData);
      });

      console.log(
        `📡 Broadcasted agent status to ${
          departmentIds.length
        } department(s): ${departmentIds.join(", ")}`,
      );
    } catch (error) {
      console.error("❌ Error broadcasting status change:", error);
    }
  }

  /**
   * Notify about assigned chats via Socket.IO
   * @param {Object} io - Socket.IO instance
   * @param {Array} assignedChats - Array of assigned chat groups
   * @param {number} agentId - Agent user ID
   */
  notifyAssignedChats(io, assignedChats, agentId) {
    // This method is deprecated - notification is now handled in socket-simple/agent-status.js
    // Keeping for backward compatibility but does nothing
    console.log(
      `⚠️ notifyAssignedChats called but is deprecated - handled in socket layer`,
    );
  }
}

module.exports = new AgentStatusService();
