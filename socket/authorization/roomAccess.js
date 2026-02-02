const supabase = require('../../helpers/supabaseClient');

/**
 * Room Access Control
 * Handles authorization for chat room access and operations
 */
class RoomAccess {
  constructor() {
    this.cache = new Map(); // Simple in-memory cache for room permissions
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache timeout
  }

  /**
   * Check if user can join a specific chat room
   */
  async canJoinRoom(userContext, chatGroupId) {
    console.log('can join room: ', userContext)
    try {
      console.log(`🔐 Checking room access for ${userContext.userType} ${userContext.userId} to room ${chatGroupId}`);
      
      // Validate room ID
      const roomId = this.validateRoomId(chatGroupId);
      
      // Get room information
      const roomInfo = await this.getRoomInfo(roomId);
      
      // Check user-specific access
      if (userContext.userType === 'client') {
        return await this.checkClientRoomAccess(userContext, roomInfo);
      } else if (userContext.userType === 'agent') {
        return await this.checkAgentRoomAccess(userContext, roomInfo);
      }
      
      throw new Error(`Unknown user type: ${userContext.userType}`);
    } catch (error) {
      console.error(`❌ Room access check failed:`, error.message);
      throw new Error(`Room access denied: ${error.message}`);
    }
  }

  /**
   * Check if user can send messages in a room
   */
  async canSendMessage(userContext, chatGroupId) {
    try {
      // First check if user can join the room
      const canJoin = await this.canJoinRoom(userContext, chatGroupId);
      
      if (!canJoin.allowed) {
        return canJoin;
      }

      // Additional message-specific checks
      const roomInfo = await this.getRoomInfo(chatGroupId);
      
      console.log('roomInfo: ', roomInfo)
      // Check if room is active
      if (roomInfo.status == 'ended') {
        return {
          allowed: false,
          reason: 'Chat room is inactive/ended'
        };
      }

      // Check if user has message permissions
      if (!userContext.permissions?.canSendMessages) {
        return {
          allowed: false,
          reason: 'User does not have message sending permissions'
        };
      }

      return {
        allowed: true,
        roomInfo: roomInfo
      };
    } catch (error) {
      console.error(`❌ Message permission check failed:`, error.message);
      return {
        allowed: false,
        reason: error.message
      };
    }
  }

  /**
   * Check if user can view messages in a room
   */
  async canViewMessages(userContext, chatGroupId) {
    try {
      // Similar to canSendMessage but for viewing
      const canJoin = await this.canJoinRoom(userContext, chatGroupId);
      
      if (!canJoin.allowed) {
        return canJoin;
      }

      if (!userContext.permissions?.canViewMessages) {
        return {
          allowed: false,
          reason: 'User does not have message viewing permissions'
        };
      }

      return {
        allowed: true,
        roomInfo: canJoin.roomInfo
      };
    } catch (error) {
      return {
        allowed: false,
        reason: error.message
      };
    }
  }

  /**
   * Check client access to room
   */
  async checkClientRoomAccess(userContext, roomInfo) {
    // Clients can only access rooms they own
    console.log(userContext.clientId)
    console.log(roomInfo.client_id)
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
   * Check agent access to room
   */
  async checkAgentRoomAccess(userContext, roomInfo) {
    // Check if agent account is active
    if (!userContext.isActive) {
      return {
        allowed: false,
        reason: 'Agent account is inactive'
      };
    }

    // Admin agents can access all rooms
    if (userContext.permissions?.canAccessAllDepartments) {
      return {
        allowed: true,
        roomInfo: roomInfo,
        accessType: 'admin'
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
    const departmentAccess = await this.checkDepartmentAccess(userContext, roomInfo);
    if (departmentAccess.allowed) {
      return departmentAccess;
    }

    return {
      allowed: false,
      reason: 'Agent not authorized for this chat room'
    };
  }

  /**
   * Check department-level access for agents
   */
  async checkDepartmentAccess(userContext, roomInfo) {
    try {
      // Get client's department from room info
      const clientDepartment = await this.getClientDepartment(roomInfo.client_id);
      
      // Get agent's department permissions
      const agentDepartments = await this.getAgentDepartments(userContext.userId);
      
      // Check if agent has access to client's department
      const hasAccess = agentDepartments.some(dept => dept.department_id === clientDepartment.department_id);
      
      if (hasAccess) {
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
   * Get room information from database
   */
  async getRoomInfo(chatGroupId) {
    const cacheKey = `room_${chatGroupId}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
      this.cache.delete(cacheKey);
    }

    try {
      const { data: roomInfo, error } = await supabase
        .from('chat_group')
        .select(`
          chat_group_id,
          client_id,
          sys_user_id,
          status,
          created_at,
          client:client_id (
            client_id
          )
        `)
        .eq('chat_group_id', chatGroupId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch room info: ${error.message}`);
      }

      if (!roomInfo) {
        throw new Error('Chat room not found');
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: roomInfo,
        timestamp: Date.now()
      });

      return roomInfo;
    } catch (error) {
      throw new Error(`Room info fetch failed: ${error.message}`);
    }
  }

  /**
   * Get client's department
   */
  async getClientDepartment(clientId) {
    try {
      const { data: chatGroup, error } = await supabase
        .from('chat_group')
        .select(`
          dept_id,
          department:dept_id (
            dept_id,
            dept_name
          )
        `)
        .eq('client_id', clientId)
        .single();

      if (error || !chatGroup) {
        throw new Error('Client department not found');
      }

      return chatGroup.department;
    } catch (error) {
      throw new Error(`Failed to get client department: ${error.message}`);
    }
  }

  /**
   * Get agent's department permissions
   */
  async getAgentDepartments(agentId) {
    try {
      const { data: userDepartments, error } = await supabase
        .from('sys_user_department')
        .select(`
          id,
          sys_user_id,
          dept_id,
          department:dept_id (
            dept_id,
            dept_name,
            dept_is_active
          )
        `)
        .eq('sys_user_id', agentId)
        .eq('department.dept_is_active', true);

      if (error) {
        throw new Error('Failed to fetch agent departments');
      }

      return userDepartments?.map(ud => ud.department).filter(Boolean) || [];
    } catch (error) {
      console.error('Failed to get agent departments:', error);
      return [];
    }
  }

  /**
   * Validate room ID format
   */
  validateRoomId(roomId) {
    if (!roomId) {
      throw new Error('Room ID is required');
    }

    const numericRoomId = parseInt(roomId);
    if (isNaN(numericRoomId) || numericRoomId <= 0) {
      throw new Error('Room ID must be a positive integer');
    }

    return numericRoomId;
  }

  /**
   * Clear cache for a specific room (useful when room data changes)
   */
  clearRoomCache(chatGroupId) {
    const cacheKey = `room_${chatGroupId}`;
    this.cache.delete(cacheKey);
  }

  /**
   * Clear all cached room data
   */
  clearAllCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics (for monitoring)
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Check if user can transfer chat to another agent
   */
  async canTransferChat(userContext, chatGroupId, targetAgentId) {
    try {
      // Only agents can transfer chats
      if (userContext.userType !== 'agent') {
        return {
          allowed: false,
          reason: 'Only agents can transfer chats'
        };
      }

      // Check if user has transfer permissions
      if (!userContext.permissions?.canTransferChats) {
        return {
          allowed: false,
          reason: 'User does not have chat transfer permissions'
        };
      }

      // Check if user has access to the room
      const roomAccess = await this.canJoinRoom(userContext, chatGroupId);
      if (!roomAccess.allowed) {
        return roomAccess;
      }

      // Validate target agent
      if (targetAgentId) {
        const targetAgentValid = await this.validateTargetAgent(targetAgentId);
        if (!targetAgentValid.valid) {
          return {
            allowed: false,
            reason: targetAgentValid.reason
          };
        }
      }

      return {
        allowed: true,
        roomInfo: roomAccess.roomInfo
      };
    } catch (error) {
      return {
        allowed: false,
        reason: error.message
      };
    }
  }

  /**
   * Validate target agent for chat transfer
   */
  async validateTargetAgent(targetAgentId) {
    try {
      const { data: agent, error } = await supabase
        .from('sys_user')
        .select('sys_user_id, is_active, role_id')
        .eq('sys_user_id', targetAgentId)
        .single();

      if (error || !agent) {
        return {
          valid: false,
          reason: 'Target agent not found'
        };
      }

      if (!agent.is_active) {
        return {
          valid: false,
          reason: 'Target agent is inactive'
        };
      }

      return {
        valid: true,
        agent: agent
      };
    } catch (error) {
      return {
        valid: false,
        reason: 'Failed to validate target agent'
      };
    }
  }
}

module.exports = RoomAccess;