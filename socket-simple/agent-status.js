/**
 * Agent Status Management
 * Handles agent online/offline status, heartbeats, and status updates
 */

const supabase = require("../helpers/supabaseClient");

// In-memory storage for agent statuses
const agentStatuses = new Map();
const rateLimits = new Map();

// Global rate limiting
let globalHeartbeatCount = 0;
let globalHeartbeatWindow = Date.now();
const GLOBAL_HEARTBEAT_LIMIT = 500; // Max 500 heartbeats per minute globally

/**
 * Handle agent coming online
 */
async function handleAgentOnline(socket, io) {
  try {
    if (!socket.isAuthenticated || !socket.user) {
      socket.emit("agentStatusError", { error: "Authentication required" });
      return;
    }

    const userId = socket.user.userId;
    const userType = socket.user.userType;
    const now = new Date();

    // Fetch current agent status from database
    const { data: userData, error } = await supabase
      .from("sys_user")
      .select("agent_status")
      .eq("sys_user_id", userId)
      .single();

    if (error) {
      console.error("❌ Error fetching agent status:", error);
      socket.emit("agentStatusError", {
        error: "Failed to fetch agent status",
      });
      return;
    }

    // Use existing status from database, but handle offline status intelligently
    // If status is offline (from previous disconnect), default to not_accepting_chats
    // This prevents agents from automatically accepting chats after reconnection
    let agentStatus = userData?.agent_status;
    
    if (!agentStatus || agentStatus === "offline") {
      agentStatus = "not_accepting_chats";
      console.log(`🔄 Agent ${userId} reconnected, defaulting to not_accepting_chats`);
    } else {
      console.log(`🔄 Agent ${userId} reconnected, restoring status: ${agentStatus}`);
    }

    // Store agent status in memory
    agentStatuses.set(userId, {
      userId,
      userType,
      socketId: socket.id,
      lastSeen: now,
      agentStatus,
    });

    // Update database with corrected status and last_seen
    await supabase
      .from("sys_user")
      .update({
        agent_status: agentStatus,
        last_seen: now.toISOString(),
      })
      .eq("sys_user_id", userId);

    // Broadcast status change to agents in same departments only
    await broadcastStatusChangeToDepartments(
      io,
      userId,
      agentStatus,
      userType,
      now,
    );

    console.log(`✅ Agent ${userId} (${userType}) is now ${agentStatus}`);

    // Only assign queued chats if agent is accepting_chats
    if (agentStatus === "accepting_chats") {
      await assignQueuedChatsToNewAgent(userId, io);
    }
  } catch (error) {
    console.error("❌ Error handling agent online:", error);
    socket.emit("agentStatusError", { error: "Failed to set agent status" });
  }
}

/**
 * Handle agent heartbeat
 */
async function handleAgentHeartbeat(socket) {
  try {
    if (!socket.isAuthenticated || !socket.user) {
      return;
    }

    const userId = socket.user.userId;
    const now = new Date();

    // Global rate limiting (prevent DDoS)
    if (now - globalHeartbeatWindow > 60000) {
      // Reset global counter every minute
      globalHeartbeatCount = 0;
      globalHeartbeatWindow = now;
    }

    if (globalHeartbeatCount >= GLOBAL_HEARTBEAT_LIMIT) {
      console.warn("⚠️ Global heartbeat rate limit exceeded");
      return;
    }

    globalHeartbeatCount++;

    // Per-user rate limiting: Only process heartbeat every 5 seconds
    const lastHeartbeat = rateLimits.get(userId);
    if (lastHeartbeat && now - lastHeartbeat < 5000) {
      return; // Skip this heartbeat
    }

    rateLimits.set(userId, now);

    // Update in-memory status
    const agentData = agentStatuses.get(userId);
    if (agentData) {
      agentData.lastSeen = now;
      agentStatuses.set(userId, agentData);
    }

    // Acknowledge heartbeat
    socket.emit("agentHeartbeatAck", { timestamp: now });
  } catch (error) {
    console.error("❌ Error handling agent heartbeat:", error);
  }
}

/**
 * Handle agent status update (accepting_chats, not_accepting_chats)
 * socket first; then rest api
 */
async function handleUpdateAgentStatus(socket, io, data) {
  try {
    if (!socket.isAuthenticated || !socket.user) {
      socket.emit("agentStatusError", { error: "Authentication required" });
      return;
    }

    const userId = socket.user.userId;
    const { agentStatus } = data;

    // Validate status
    const validStatuses = ["accepting_chats", "not_accepting_chats"];
    if (!agentStatus || !validStatuses.includes(agentStatus)) {
      socket.emit("agentStatusError", {
        error:
          "Invalid agent_status. Must be one of: accepting_chats, not_accepting_chats",
      });
      return;
    }

    const now = new Date();

    // Update in-memory status
    const agentData = agentStatuses.get(userId);
    if (agentData) {
      agentData.agentStatus = agentStatus;
      agentData.lastSeen = now;
      agentStatuses.set(userId, agentData);
    } else {
      // Create new entry if not exists
      agentStatuses.set(userId, {
        userId,
        userType: socket.user.userType,
        socketId: socket.id,
        lastSeen: now,
        agentStatus,
      });
    }

    // Update database
    await supabase
      .from("sys_user")
      .update({
        agent_status: agentStatus,
        last_seen: now.toISOString(),
      })
      .eq("sys_user_id", userId);

    // Broadcast status change to agents in same departments only
    await broadcastStatusChangeToDepartments(
      io,
      userId,
      agentStatus,
      socket.user.userType,
      now,
    );

    // If agent is now accepting chats, assign queued chats
    if (agentStatus === "accepting_chats") {
      await assignQueuedChatsToNewAgent(userId, io);
    }

    console.log(`✅ Agent ${userId} status updated to ${agentStatus}`);
  } catch (error) {
    console.error("❌ Error updating agent status:", error);
    socket.emit("agentStatusError", { error: "Failed to update agent status" });
  }
}

/**
 * Handle get agent statuses request
 */
async function handleGetAgentStatuses(socket) {
  try {
    if (!socket.isAuthenticated || !socket.user) {
      socket.emit("agentStatusError", { error: "Authentication required" });
      return;
    }

    const requestingUserId = socket.user.userId;
    const agentStatusesResult = {};

    // First, get the requesting user's departments
    const { data: userDepartments, error: deptError } = await supabase
      .from("sys_user_department")
      .select("dept_id")
      .eq("sys_user_id", requestingUserId);

    if (deptError) {
      console.error("❌ Error fetching user departments:", deptError);
      socket.emit("agentStatusError", { error: "Failed to fetch departments" });
      return;
    }

    const departmentIds = userDepartments?.map((d) => d.dept_id) || [];

    if (departmentIds.length === 0) {
      console.log("⚠️ User has no departments, returning empty agent list");
      socket.emit("agentStatusesList", {});
      return;
    }

    // Get all users in the same departments
    const { data: departmentUsers, error: usersError } = await supabase
      .from("sys_user_department")
      .select("sys_user_id")
      .in("dept_id", departmentIds);

    if (usersError) {
      console.error("❌ Error fetching department users:", usersError);
      socket.emit("agentStatusError", {
        error: "Failed to fetch department users",
      });
      return;
    }

    const departmentUserIds = [
      ...new Set(departmentUsers?.map((u) => u.sys_user_id) || []),
    ];

    // Add in-memory statuses (filtered by department)
    agentStatuses.forEach((agentData, userId) => {
      if (departmentUserIds.includes(userId)) {
        agentStatusesResult[userId] = {
          userId: agentData.userId,
          userType: agentData.userType,
          agentStatus: agentData.agentStatus,
          lastSeen: agentData.lastSeen,
        };
      }
    });

    // Fetch agent statuses from database (filtered by department)
    try {
      const { data: agents, error } = await supabase
        .from("sys_user")
        .select("sys_user_id, agent_status, last_seen")
        .in("sys_user_id", departmentUserIds)
        .not("agent_status", "is", null);

      if (!error && agents) {
        agents.forEach((agent) => {
          // Only add if not already in memory (in-memory is more up-to-date)
          if (!agentStatusesResult[agent.sys_user_id]) {
            agentStatusesResult[agent.sys_user_id] = {
              userId: agent.sys_user_id,
              userType: "agent",
              agentStatus: agent.agent_status || "offline",
              lastSeen: agent.last_seen
                ? new Date(agent.last_seen)
                : new Date(),
            };
          }
        });
      }
    } catch (dbError) {
      console.error("❌ Error fetching agent statuses from database:", dbError);
    }

    console.log(
      `📋 Returning ${
        Object.keys(agentStatusesResult).length
      } agent statuses for user ${requestingUserId}`,
    );
    socket.emit("agentStatusesList", agentStatusesResult);
  } catch (error) {
    console.error("❌ Error handling get agent statuses:", error);
    socket.emit("agentStatusError", { error: "Failed to get agent statuses" });
  }
}

/**
 * Handle explicit agent offline request (not just disconnect)
 */
async function handleAgentExplicitOffline(socket, io) {
  try {
    if (!socket.user) {
      return;
    }

    const userId = socket.user.userId;

    console.log(`😴 Agent ${userId} explicitly going offline`);
    await setAgentOffline(userId, io);
  } catch (error) {
    console.error("❌ Error handling agent explicit offline:", error);
  }
}

/**
 * Handle agent disconnect - clean up memory only, preserve DB status
 */
async function handleAgentDisconnect(socket, io) {
  try {
    if (!socket.user) {
      return;
    }

    const userId = socket.user.userId;

    console.log(`👋 Agent ${userId} disconnected, cleaning up memory (preserving DB status)`);
    
    // Only clean up in-memory state, don't set offline in database
    // This prevents page refresh from changing agent status
    agentStatuses.delete(userId);
    rateLimits.delete(userId);

    console.log(`🧹 Cleaned up memory for agent ${userId}`);
  } catch (error) {
    console.error("❌ Error handling agent disconnect:", error);
  }
}

/**
 * Set agent offline
 */
async function setAgentOffline(userId, io) {
  const now = new Date();

  // Update in-memory status
  const agentData = agentStatuses.get(userId);
  if (agentData) {
    agentData.agentStatus = "offline";
    agentData.lastSeen = now;
    agentStatuses.set(userId, agentData);
  }

  // Update database
  try {
    await supabase
      .from("sys_user")
      .update({
        agent_status: "offline",
        last_seen: now.toISOString(),
      })
      .eq("sys_user_id", userId);
  } catch (err) {
    console.error("❌ Error updating agent offline status:", err);
  }

  // Broadcast status change to agents in same departments only
  await broadcastStatusChangeToDepartments(io, userId, "offline", "agent", now);

  // Remove from in-memory storage
  agentStatuses.delete(userId);
  rateLimits.delete(userId);

  console.log(`👋 Agent ${userId} is now offline`);
}

/**
 * Broadcast agent status change to agents in same departments
 */
async function broadcastStatusChangeToDepartments(
  io,
  userId,
  agentStatus,
  userType,
  lastSeen,
) {
  try {
    // Get the agent's departments
    const { data: userDepartments, error } = await supabase
      .from("sys_user_department")
      .select("dept_id")
      .eq("sys_user_id", userId);

    if (error) {
      console.error("❌ Error fetching user departments for broadcast:", error);
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
      agentStatus,
      userType,
      lastSeen,
    };

    departmentIds.forEach((deptId) => {
      io.to(`department_${deptId}`).emit("agentStatusChanged", statusData);
    });
  } catch (error) {
    console.error("❌ Error broadcasting status change to departments:", error);
  }
}

/**
 * Assign queued chats to newly available agent
 */
async function assignQueuedChatsToNewAgent(agentId, io) {
  try {
    const agentAssignmentService = require("../services/agentAssignment.service");
    const { handleChatAssignment } = require("./customer-list");

    // Assign queued chats to the agent
    const assignedChats = await agentAssignmentService.assignQueuedChatsToAgent(
      agentId,
    );

    if (assignedChats.length === 0) {
      // console.log(`📋 No queued chats to assign to agent ${agentId}`);
      return;
    }

    // Notify the agent about each assigned chat
    for (const chat of assignedChats) {
      await handleChatAssignment(io, chat.chat_group_id, agentId);

      // Also emit remove_chat_group to other agents in the department
      io.to(`department_${chat.dept_id}`).emit("customerListUpdate", {
        type: "remove_chat_group",
        data: {
          chat_group_id: chat.chat_group_id,
          accepted_by: agentId,
          department_id: chat.dept_id,
        },
      });

      console.log(
        `📡 Notified agent ${agentId} about assigned chat ${chat.chat_group_id}`,
      );
    }
  } catch (error) {
    console.error("❌ Error assigning queued chats to new agent:", error);
  }
}

/**
 * Check for idle agents and set them offline
 * This is the primary way agents are set to offline status in the database
 */
async function checkIdleAgents(io) {
  const now = new Date();
  const idleThreshold = 12 * 60 * 1000; // 12 minutes

  for (const [userId, agentData] of agentStatuses.entries()) {
    const idleTime = now - agentData.lastSeen;

    if (idleTime >= idleThreshold && agentData.agentStatus !== "offline") {
      console.log(
        `😴 Agent ${userId} idle for ${Math.floor(
          idleTime / 60000,
        )} minutes, setting offline`,
      );
      await setAgentOffline(userId, io);
    }
  }
}

/**
 * Cleanup rate limits
 */
function cleanupRateLimits() {
  const now = new Date();
  const staleThreshold = 300000; // 5 minutes

  for (const [userId, lastHeartbeat] of rateLimits.entries()) {
    if (now - lastHeartbeat > staleThreshold) {
      rateLimits.delete(userId);
    }
  }
}

/**
 * Get current agent statuses
 */
function getAgentStatuses() {
  const statuses = {};
  agentStatuses.forEach((agentData, userId) => {
    statuses[userId] = {
      userId: agentData.userId,
      userType: agentData.userType,
      agentStatus: agentData.agentStatus,
      lastSeen: agentData.lastSeen,
    };
  });
  return statuses;
}

module.exports = {
  handleAgentOnline,
  handleAgentHeartbeat,
  handleUpdateAgentStatus,
  handleGetAgentStatuses,
  handleAgentDisconnect,
  handleAgentExplicitOffline,
  setAgentOffline,
  checkIdleAgents,
  cleanupRateLimits,
  getAgentStatuses,
  broadcastStatusChangeToDepartments,
};
