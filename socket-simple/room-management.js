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
 * Handle user joining room with broadcasts
 */
function handleUserJoined(io, socket, roomId, userType, userId, chatGroupId) {
  // Broadcast to room that user joined
  socket.to(roomId).emit('userJoined', {
    userType,
    userId,
    chatGroupId,
    timestamp: new Date().toISOString()
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