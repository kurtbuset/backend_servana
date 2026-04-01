/**
 * Socket Connection Lifecycle Management
 * Handles connect, disconnect, and handshake events
 */

const { cacheManager } = require('../helpers/redisClient');
const { USER_PRESENCE_STATUS } = require('../constants/statuses');
const agentAssignmentService = require('../services/agentAssignment.service');
const { handleChatAssignment } = require('./customer-list');
const supabase = require('../helpers/supabaseClient');
const queueService = require('../services/queue.service');
const { joinDepartmentRooms } = require('./room-management');

/**
 * Set presence in Redis and broadcast to all clients.
 * Shared by updateUserPresence, SocketManager cleanup, and forceUpdatePresence.
 */
async function setPresenceAndBroadcast(io, userId, presenceData, broadcastExtra = {}) {
  await cacheManager.setUserPresence(userId, presenceData);
  io.emit('presence:change', {
    userId,
    userType: presenceData.userType,
    status: presenceData.userPresence,
    firstName: presenceData.firstName,
    lastName: presenceData.lastName,
    deptIds: presenceData.deptIds,
    timestamp: presenceData.lastSeen,
    ...broadcastExtra
  });
}

/**
 * Drain queued chats for an agent and broadcast assignments
 */
async function drainQueueForAgent(io, userId) {
  try {
    const assignedChats = await agentAssignmentService.assignQueuedChatsToAgent(userId);
    for (const chat of assignedChats) {
      await handleChatAssignment(io, chat.chat_group_id, userId);
    }
    if (assignedChats.length > 0) {
      console.log(`📬 Queue drain: assigned ${assignedChats.length} chats to agent ${userId}`);
    }
  } catch (err) {
    console.error('❌ Error draining queue:', err.message);
  }
}

/**
 * Handle new socket connection
 */
async function handleConnection(socket, io) {
  // Join department rooms for agents
  if (socket.user?.userType === 'agent' || socket.user?.userType === 'admin') {
    await joinDepartmentRooms(socket);
  }
  
  // Set user presence to online when they connect
  if (socket.user?.userType === 'agent' || socket.user?.userType === 'admin') {
    await updateUserPresence(socket, USER_PRESENCE_STATUS.ACCEPTING_CHATS, io);
    await drainQueueForAgent(io, socket.user.userId);
  }
  
  // Set up presence event handlers
  setupPresenceHandlers(socket, io);
  
  // Set up disconnect handler
  setupDisconnectHandler(socket, io);
  
  // Set up error handler
  setupErrorHandler(socket);
}

/**
 * Update user presence in Redis and broadcast to all clients
 */
async function updateUserPresence(socket, status, io) {
  const userId = socket.user?.userId;
  const userType = socket.user?.userType;

  if (!userId || (userType !== 'agent' && userType !== 'admin')) {
    return;
  }

  try {
    // Get agent's department IDs (cached for 10 minutes)
    const deptIds = await queueService.getCachedUserDepartments(userId);

    const presenceData = {
      userPresence: status,
      socketId: socket.id,
      userType: userType,
      lastSeen: new Date().toISOString(),
      firstName: socket.user?.firstName,
      lastName: socket.user?.lastName,
      email: socket.user?.email,
      deptIds
    };

    await setPresenceAndBroadcast(io, userId, presenceData);
    console.log(`👤 User presence updated: ${userId} -> ${status}`);
  } catch (error) {
    console.error('❌ Error updating user presence:', error);
  }
}

/**
 * Set up presence-related event handlers
 */
function setupPresenceHandlers(socket, io) {
  // Handle status change requests
  socket.on('presence:update', async ({ status }) => {
    const validStatuses = Object.values(USER_PRESENCE_STATUS);

    if (!validStatuses.includes(status)) {
      socket.emit('error', { message: `Invalid status: ${status}` });
      return;
    }

    await updateUserPresence(socket, status, io);

    // When agent becomes available, drain queued chats via round-robin
    if (status === USER_PRESENCE_STATUS.ACCEPTING_CHATS && socket.user?.userId) {
      await drainQueueForAgent(io, socket.user.userId);
    }
  });

  // Handle heartbeat to keep presence alive
  socket.on('presence:heartbeat', async () => {
    const userId = socket.user?.userId;
    
    if (userId) {
      await cacheManager.updateUserHeartbeat(userId);
      socket.emit('presence:heartbeat:ack', { timestamp: new Date().toISOString() });
    }
  });

  // Handle request for all user presences
  socket.on('presence:getAll', async () => {
    try {
      const allPresences = await cacheManager.getAllUserPresence();
      socket.emit('presence:all', allPresences);
    } catch (error) {
      console.error('❌ Error getting all presences:', error);
      socket.emit('error', { message: 'Failed to get user presences' });
    }
  });

  // Handle request for available agents grouped by department (for Transfer Modal)
  socket.on('presence:getAvailableByDepartment', async () => {
    try {
      // Get all departments
      const { data: departments, error: deptError } = await supabase
        .from("department")
        .select("dept_id, dept_name")
        .eq("dept_is_active", true);

      if (deptError) throw deptError;

      // Get all agent-department mappings with profile info
      const { data: agentDepts, error: adError } = await supabase
        .from("sys_user_department")
        .select(`
          sys_user_id,
          dept_id,
          sys_user:sys_user!inner(
            sys_user_id,
            sys_user_is_active,
            sys_user_email,
            role:role!inner(role_name),
            profile:prof_id(prof_firstname, prof_lastname)
          )
        `)
        .eq("sys_user.sys_user_is_active", true)
        .eq("sys_user.role.role_name", "Agent");

      if (adError) throw adError;

      // Get all presences from Redis
      const allPresences = await cacheManager.getAllUserPresence();

      // Build agent-to-departments map and filter by accepting_chats
      const agentMap = {};
      for (const ad of (agentDepts || [])) {
        const userId = ad.sys_user?.sys_user_id;
        if (!userId) continue;

        const presence = allPresences[userId];
        const isAvailable = presence && presence.userPresence === USER_PRESENCE_STATUS.ACCEPTING_CHATS;

        if (!agentMap[userId]) {
          agentMap[userId] = {
            userId,
            firstName: ad.sys_user?.profile?.prof_firstname || presence?.firstName || '',
            lastName: ad.sys_user?.profile?.prof_lastname || presence?.lastName || '',
            email: ad.sys_user?.sys_user_email || presence?.email || '',
            deptIds: [],
            isAvailable,
          };
        }
        agentMap[userId].deptIds.push(ad.dept_id);
      }

      // Build department availability counts
      const deptAvailability = (departments || []).map((dept) => {
        const availableCount = Object.values(agentMap).filter(
          (a) => a.isAvailable && a.deptIds.includes(dept.dept_id)
        ).length;
        return {
          dept_id: dept.dept_id,
          dept_name: dept.dept_name,
          availableCount,
        };
      });

      // Filter to only available agents
      const availableAgents = Object.values(agentMap).filter((a) => a.isAvailable);

      socket.emit('presence:availableByDepartment', {
        departments: deptAvailability,
        availableAgents,
      });
    } catch (error) {
      console.error('❌ Error getting available agents by department:', error);
      socket.emit('error', { message: 'Failed to get available agents by department' });
    }
  });
}

/**
 * Set up disconnect event handler
 */
function setupDisconnectHandler(socket, io) {
  socket.on('disconnect', async (reason) => {
    // Update user presence to offline
    if (socket.user?.userId && (socket.user?.userType === 'agent' || socket.user?.userType === 'admin')) {
      await updateUserPresence(socket, USER_PRESENCE_STATUS.OFFLINE, io);
    }
    
    // Leave all rooms
    if (socket.currentChatGroup) {
      const roomName = `chat_${socket.currentChatGroup}`;
      const roomSize = socket.server.sockets.adapter.rooms.get(roomName)?.size || 0;
      
      socket.leave(roomName);
      
      // Log room leave on disconnect
      console.log(`🚪 ${socket.user?.userType} ${socket.user?.userId} left room: ${roomName} on disconnect (${roomSize - 1} users remaining)`);
      
      // Log all rooms this socket was in
      const userRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
      if (userRooms.length > 0) {
        console.log(`📍 Socket ${socket.id} was in rooms: [${userRooms.join(', ')}] before disconnect`);
      }
    }
    
    // Clean up socket data
    cleanupSocketData(socket);
  });
}

/**
 * Set up error event handler
 */
function setupErrorHandler(socket) {
  socket.on('error', (error) => {
    console.error(`❌ Socket error for user ${socket.user?.userId}:`, {
      error: error.message,
      socketId: socket.id,
      userType: socket.user?.userType
    });
  });
}

/**
 * Clean up socket data on disconnect
 */
function cleanupSocketData(socket) {
  // Clear user context
  socket.user = null;
  socket.isAuthenticated = false;
  socket.clientType = null;
  socket.authenticatedAt = null;
  socket.currentChatGroup = null;
}

/**
 * Handle connection errors at the engine level
 */
function setupGlobalErrorHandlers(io) {
  io.engine.on('connection_error', (err) => {
    console.error('❌ Socket.IO connection error:', {
      message: err.message,
      description: err.description,
      context: err.context,
      type: err.type,
      timestamp: new Date().toISOString()
    });
    
    // Handle specific connection errors
    if (err.message.includes('Authentication failed')) {
      console.error('🚨 Authentication failed - token may be expired');
    } else if (err.message.includes('xhr poll error')) {
      console.error('🚨 XHR poll error - cookie may have expired');
    }
  });
  
  // Monitor connection attempts
  io.engine.on('initial_headers', (headers, request) => {
    // console.log('🔍 New connection attempt from:', request.socket.remoteAddress);
  });
}

/**
 * Get connection statistics
 */
function getConnectionStats(io) {
  const sockets = io.sockets.sockets;
  const stats = {
    total: sockets.size,
    agents: 0,
    clients: 0,
    web: 0,
    mobile: 0
  };
  
  sockets.forEach(socket => { 
    if (socket.user?.userType === 'agent') stats.agents++;
    if (socket.user?.userType === 'client') stats.clients++;
    if (socket.clientType === 'web') stats.web++;
    if (socket.clientType === 'mobile') stats.mobile++;
  });
  
  return stats;
}

module.exports = {
  handleConnection,
  setupDisconnectHandler,
  setupErrorHandler,
  setupGlobalErrorHandlers,
  getConnectionStats,
  cleanupSocketData,
  updateUserPresence,
  setPresenceAndBroadcast
};