/**
 * Room Management & Authorization
 * Handles room joining, leaving, and access control
 */

const supabase = require('../helpers/supabaseClient');

/**
 * Join agent to their department rooms
 */
async function joinDepartmentRooms(socket) {
  try {
    if (!socket.user || socket.user.userType !== 'agent') {
      return;
    }

    // Get agent's departments
    const { data: userDepartments, error } = await supabase
      .from('sys_user_department')
      .select('dept_id')
      .eq('sys_user_id', socket.user.userId);

    if (error || !userDepartments) {
      console.error('❌ Error getting agent departments for room joining:', error);
      return;
    }

    // Join department rooms
    userDepartments.forEach(dept => {
      const departmentRoom = `department_${dept.dept_id}`;
      socket.join(departmentRoom);
    });

    // Also join individual agent room
    const agentRoom = `agent_${socket.user.userId}`;
    socket.join(agentRoom);

    console.log(`✅ Agent ${socket.user.userId} joined ${userDepartments.length} department rooms`);

  } catch (error) {
    console.error('❌ Error joining department rooms:', error);
  }
}

/**
 * Check if user can join a specific chat room
 */
async function canJoinRoom(userContext, chatGroupId) {
  try {
    // Get room information
    const roomInfo = await getRoomInfo(chatGroupId);

    // Check user-specific access
    if (userContext.userType === 'client') {
      return checkClientRoomAccess(userContext, roomInfo);
    } else if (userContext.userType === 'agent') {
      return checkAgentRoomAccess(userContext, roomInfo);
    }

    throw new Error(`Unknown user type: ${userContext.userType}`);
  } catch (error) {
    console.error(`❌ Room access check failed:`, error.message);
    return {
      allowed: false,
      reason: error.message
    };
  }
}

/**
 * Check agent room access
 */
async function checkAgentRoomAccess(userContext, roomInfo) {
  // Check if agent account is active
  if (!userContext.isActive) {
    return {
      allowed: false,
      reason: 'Agent account is inactive'
    };
  }

  // Check if agent is assigned to this room
  if (roomInfo.sys_user_id === userContext.userId) {
    return {
      allowed: true,
      roomInfo: roomInfo,
      accessType: 'assigned'
    };
  }

  // Check department-level access
  const departmentAccess = await checkDepartmentAccess(userContext, roomInfo);
  if (departmentAccess.allowed) {
    return departmentAccess;
  }

  return {
    allowed: false,
    reason: 'Agent not authorized for this chat room'
  };
}

/**
 * Check client room access
 */
function checkClientRoomAccess(userContext, roomInfo) {
  // Clients can only access rooms they own
  if (roomInfo.client_id !== userContext.clientId) {
    return {
      allowed: false,
      reason: 'Client can only access their own chat rooms'
    };
  }

  // Check if client account is active
  if (!userContext.isActive) {
    return {
      allowed: false,
      reason: 'Client account is inactive'
    };
  }

  return {
    allowed: true,
    roomInfo: roomInfo,
    accessType: 'owner'
  };
}

/**
 * Check department access
 */
async function checkDepartmentAccess(userContext, roomInfo) {
  try {
    // Get agent's department permissions
    const { data: userDepartments, error } = await supabase
      .from('sys_user_department')
      .select('dept_id')
      .eq('sys_user_id', userContext.userId);

    if (error || !userDepartments) {
      return {
        allowed: false,
        reason: 'Failed to verify department access'
      };
    }

    const agentDepartmentIds = userDepartments.map(d => d.dept_id);

    // Check if agent has access to room's department
    if (agentDepartmentIds.includes(roomInfo.dept_id)) {
      return {
        allowed: true,
        roomInfo: roomInfo,
        accessType: 'department'
      };
    }

    return {
      allowed: false,
      reason: 'Agent not authorized for this department'
    };
  } catch (error) {
    console.error('Department access check failed:', error);
    return {
      allowed: false,
      reason: 'Failed to verify department access'
    };
  }
}

/**
 * Get room information
 */
async function getRoomInfo(chatGroupId) {
  try {
    const { data, error } = await supabase
      .from('chat_group')
      .select(`
        chat_group_id,
        client_id,
        sys_user_id,
        dept_id,
        status,
        created_at
      `)
      .eq('chat_group_id', chatGroupId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch room info: ${error.message}`);
    }

    if (!data) {
      throw new Error('Chat room not found');
    }

    return data;
  } catch (error) {
    throw new Error(`Room info fetch failed: ${error.message}`);
  }
}

/**
 * Auto-mark messages as read when user joins room
 * Phase 1: Latest message immediately for instant feedback
 * Phase 2: Recent messages (24h) in background for proper read counts
 */
async function autoMarkMessagesAsRead(io, roomId, userType, userId, chatGroupId) {
  try {
    const timestamp = new Date().toISOString();
    
    // Phase 1: Mark latest message immediately for instant feedback
    const latestMessageId = await markLatestMessageAsRead(chatGroupId, userType, timestamp);
    
    if (latestMessageId) {
      // Emit immediate status update
      io.to(roomId).emit('messageStatusUpdate', {
        chatId: latestMessageId,
        status: 'read',
        timestamp,
        updatedBy: 'system',
        updatedByType: 'auto_join'
      });

      console.log(`👁️ Auto-marked latest message ${latestMessageId} as read when ${userType} ${userId} joined room ${chatGroupId}`);
    }

    // Phase 2: Mark recent messages in background after delay
    setTimeout(async () => {
      await markRecentMessagesAsRead(io, roomId, chatGroupId, userType, userId, latestMessageId);
    }, 2000);

  } catch (error) {
    console.error('❌ Error in autoMarkMessagesAsRead:', error);
  }
}

/**
 * Mark the latest unread message as read immediately
 */
async function markLatestMessageAsRead(chatGroupId, userType, timestamp) {
  try {
    let query = supabase
      .from('chat')
      .select('chat_id, sys_user_id, client_id')
      .eq('chat_group_id', chatGroupId)
      .is('chat_read_at', null)
      .not('chat_delivered_at', 'is', null)
      .order('chat_created_at', { ascending: false })
      .limit(1);

    let latestMessageId = null;
    
    if (userType === 'client') {
      const { data: messages, error } = await query.not('sys_user_id', 'is', null);
      if (!error && messages && messages.length > 0) {
        latestMessageId = messages[0].chat_id;
      }
    } else if (userType === 'agent' || userType === 'admin') {
      const { data: messages, error } = await query.not('client_id', 'is', null);
      if (!error && messages && messages.length > 0) {
        latestMessageId = messages[0].chat_id;
      }
    }

    // Update latest message
    if (latestMessageId) {
      await supabase
        .from('chat')
        .update({ chat_read_at: timestamp })
        .eq('chat_id', latestMessageId);
    }

    return latestMessageId;
  } catch (error) {
    console.error('❌ Error marking latest message as read:', error);
    return null;
  }
}

/**
 * Mark recent messages (last 24 hours) as read in background
 */
async function markRecentMessagesAsRead(io, roomId, chatGroupId, userType, userId, excludeMessageId) {
  try {
    const recentTimestamp = new Date(Date.now() - 24*60*60*1000).toISOString();
    
    let query = supabase
      .from('chat')
      .select('chat_id')
      .eq('chat_group_id', chatGroupId)
      .is('chat_read_at', null)
      .not('chat_delivered_at', 'is', null)
      .gte('chat_created_at', recentTimestamp)
      .neq('chat_id', excludeMessageId || 0)
      .limit(20);

    let recentMessageIds = [];
    
    if (userType === 'client') {
      const { data: messages, error } = await query.not('sys_user_id', 'is', null);
      if (!error && messages && messages.length > 0) {
        recentMessageIds = messages.map(m => m.chat_id);
      }
    } else if (userType === 'agent' || userType === 'admin') {
      const { data: messages, error } = await query.not('client_id', 'is', null);
      if (!error && messages && messages.length > 0) {
        recentMessageIds = messages.map(m => m.chat_id);
      }
    }

    // Batch update recent messages
    if (recentMessageIds.length > 0) {
      const batchTimestamp = new Date().toISOString();
      
      await supabase
        .from('chat')
        .update({ chat_read_at: batchTimestamp })
        .in('chat_id', recentMessageIds);

      // Emit status updates for recent messages
      recentMessageIds.forEach(chatId => {
        io.to(roomId).emit('messageStatusUpdate', {
          chatId: chatId,
          status: 'read',
          timestamp: batchTimestamp,
          updatedBy: 'system',
          updatedByType: 'auto_join_batch'
        });
      });

      console.log(`👁️ Background: Auto-marked ${recentMessageIds.length} recent messages as read for ${userType} ${userId} in room ${chatGroupId}`);
    }
  } catch (error) {
    console.error('❌ Error in background message marking:', error);
  }
}

/**
 * Handle user joining room with broadcasts
 */
async function handleUserJoined(io, socket, roomId, userType, userId, chatGroupId) {
  // Broadcast to room that user joined
  socket.to(roomId).emit('userJoined', {
    userType,
    userId,
    chatGroupId,
    timestamp: new Date().toISOString()
  });

  // Auto-mark messages as read (non-blocking)
  setImmediate(() => {
    autoMarkMessagesAsRead(io, roomId, userType, userId, chatGroupId);
  });
}

/**
 * Handle user leaving room with broadcasts
 */
function handleUserLeft(io, socket, roomId, userType, userId, chatGroupId) {
  // Broadcast to room that user left
  socket.to(roomId).emit('userLeft', {
    userType,
    userId,
    chatGroupId,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  joinDepartmentRooms,
  canJoinRoom,
  checkAgentRoomAccess,
  checkClientRoomAccess,
  checkDepartmentAccess,
  getRoomInfo,
  handleUserJoined,
  handleUserLeft
};