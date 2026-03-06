const supabase = require('../../helpers/supabaseClient');

/**
 * Agent Status Handler
 * Handles agent status updates (accepting_chats, not_accepting_chats, offline)
 */
class AgentStatusHandler {
  constructor(io) {
    this.io = io;
    this.agentStatuses = new Map(); // In-memory storage for agent statuses
    this.rateLimits = new Map(); // Rate limiting for heartbeats
  }

  /**
   * Handle agent coming online
   * Loads agent status from database instead of forcing accepting_chats
   */
  async handleAgentOnline(socket, data) {
    try {
      if (!socket.isAuthenticated || !socket.user) {
        socket.emit('agentStatusError', { error: 'Authentication required' });
        return;
      }

      const userId = socket.user.userId;
      const userType = socket.user.userType;
      const now = new Date();

      // Fetch current agent status from database
      const { data: userData, error } = await supabase
        .from('sys_user')
        .select('agent_status')
        .eq('sys_user_id', userId)
        .single();

      if (error) {
        console.error('❌ Error fetching agent status:', error);
        socket.emit('agentStatusError', { error: 'Failed to fetch agent status' });
        return;
      }

      // Use existing status from database, default to not_accepting_chats if null
      const agentStatus = userData?.agent_status || 'not_accepting_chats';

      // Store agent status in memory
      this.agentStatuses.set(userId, {
        userId,
        userType,
        socketId: socket.id,
        lastSeen: now,
        agentStatus
      });

      // Update only last_seen in database (preserve existing agent_status)
      await supabase
        .from('sys_user')
        .update({ 
          last_seen: now.toISOString() 
        })
        .eq('sys_user_id', userId);

      // Broadcast status change
      this.io.emit('agentStatusChanged', {
        userId,
        agentStatus,
        userType,
        lastSeen: now
      });

      console.log(`✅ Agent ${userId} (${userType}) is now ${agentStatus}`);

      // Only assign queued chats if agent is accepting_chats
      if (agentStatus === 'accepting_chats') {
        await this.assignQueuedChatsToNewAgent(userId);
      }
    } catch (error) {
      console.error('❌ Error handling agent online:', error);
      socket.emit('agentStatusError', { error: 'Failed to set agent status' });
    }
  }

  /**
   * Handle agent heartbeat
   */
  async handleAgentHeartbeat(socket, data) {
    try {
      if (!socket.isAuthenticated || !socket.user) {
        return;
      }

      const userId = socket.user.userId;
      const now = new Date();

      // Rate limiting: Only process heartbeat every 5 seconds
      const lastHeartbeat = this.rateLimits.get(userId);
      if (lastHeartbeat && (now - lastHeartbeat) < 5000) {
        return; // Skip this heartbeat
      }

      this.rateLimits.set(userId, now);

      // Update in-memory status
      const agentData = this.agentStatuses.get(userId);
      if (agentData) {
        agentData.lastSeen = now;
        this.agentStatuses.set(userId, agentData);
      }

      // Acknowledge heartbeat
      socket.emit('agentHeartbeatAck', { timestamp: now });
    } catch (error) {
      console.error('❌ Error handling agent heartbeat:', error);
    }
  }

  /**
   * Handle agent going offline
   */
  async handleAgentOffline(socket, data) {
    try {
      if (!socket.user) {
        return;
      }

      const userId = socket.user.userId;
      await this.setAgentOffline(userId);
    } catch (error) {
      console.error('❌ Error handling agent offline:', error);
    }
  }

  /**
   * Handle agent status update (accepting_chats, not_accepting_chats)
   */
  async handleUpdateAgentStatus(socket, data) {
    try {
      if (!socket.isAuthenticated || !socket.user) {
        socket.emit('agentStatusError', { error: 'Authentication required' });
        return;
      }

      const userId = socket.user.userId;
      const { agentStatus } = data;

      // Validate status
      const validStatuses = ['accepting_chats', 'not_accepting_chats'];
      if (!agentStatus || !validStatuses.includes(agentStatus)) {
        socket.emit('agentStatusError', { 
          error: 'Invalid agent_status. Must be one of: accepting_chats, not_accepting_chats' 
        });
        return;
      }

      const now = new Date();

      // Update in-memory status
      const agentData = this.agentStatuses.get(userId);
      if (agentData) {
        agentData.agentStatus = agentStatus;
        agentData.lastSeen = now;
        this.agentStatuses.set(userId, agentData);
      } else {
        // Create new entry if not exists
        this.agentStatuses.set(userId, {
          userId,
          userType: socket.user.userType,
          socketId: socket.id,
          lastSeen: now,
          agentStatus
        });
      }

      // Update database
      await supabase
        .from('sys_user')
        .update({ 
          agent_status: agentStatus,
          last_seen: now.toISOString() 
        })
        .eq('sys_user_id', userId);

      // Broadcast status change
      this.io.emit('agentStatusChanged', {
        userId,
        agentStatus,
        lastSeen: now
      });

      // If agent is now accepting chats, assign queued chats
      if (agentStatus === 'accepting_chats') {
        await this.assignQueuedChatsToNewAgent(userId);
      }

      console.log(`✅ Agent ${userId} status updated to ${agentStatus}`);
      socket.emit('agentStatusUpdateSuccess', { agentStatus, timestamp: now });
    } catch (error) {
      console.error('❌ Error updating agent status:', error);
      socket.emit('agentStatusError', { error: 'Failed to update agent status' });
    }
  }

  /**
   * Handle agent disconnect
   * Sets agent to offline when socket disconnects
   */
  async handleAgentDisconnect(socket) {
    try {
      if (!socket.user) {
        return;
      }

      const userId = socket.user.userId;
      
      // Set agent to offline on disconnect
      console.log(`👋 Agent ${userId} disconnected, setting to offline`);
      await this.setAgentOffline(userId);
    } catch (error) {
      console.error('❌ Error handling agent disconnect:', error);
    }
  }

  /**
   * Set agent offline
   */
  async setAgentOffline(userId) {
    const now = new Date();
    
    // Update in-memory status
    const agentData = this.agentStatuses.get(userId);
    if (agentData) {
      agentData.agentStatus = 'offline';
      agentData.lastSeen = now;
      this.agentStatuses.set(userId, agentData);
    }

    // Update database
    try {
      await supabase
        .from('sys_user')
        .update({ 
          agent_status: 'offline',
          last_seen: now.toISOString() 
        })
        .eq('sys_user_id', userId);
    } catch (err) {
      console.error('❌ Error updating agent offline status:', err);
    }

    // Broadcast status change
    this.io.emit('agentStatusChanged', {
      userId,
      agentStatus: 'offline',
      lastSeen: now
    });

    // Remove from in-memory storage
    this.agentStatuses.delete(userId);
    this.rateLimits.delete(userId);

    console.log(`👋 Agent ${userId} is now offline`);
  }

  /**
   * Handle get agent statuses request
   * Fetches from in-memory cache and database (filtered by department)
   */
  async handleGetAgentStatuses(socket) {
    try {
      if (!socket.isAuthenticated || !socket.user) {
        socket.emit('agentStatusError', { error: 'Authentication required' });
        return;
      }

      const requestingUserId = socket.user.userId;
      const agentStatuses = {};
      
      // First, get the requesting user's departments
      const { data: userDepartments, error: deptError } = await supabase
        .from('sys_user_department')
        .select('dept_id')
        .eq('sys_user_id', requestingUserId);
      
      if (deptError) {
        console.error('❌ Error fetching user departments:', deptError);
        socket.emit('agentStatusError', { error: 'Failed to fetch departments' });
        return;
      }
      
      const departmentIds = userDepartments?.map(d => d.dept_id) || [];
      
      if (departmentIds.length === 0) {
        console.log('⚠️ User has no departments, returning empty agent list');
        socket.emit('agentStatusesList', {});
        return;
      }
      
      // Get all users in the same departments
      const { data: departmentUsers, error: usersError } = await supabase
        .from('sys_user_department')
        .select('sys_user_id')
        .in('dept_id', departmentIds);
      
      if (usersError) {
        console.error('❌ Error fetching department users:', usersError);
        socket.emit('agentStatusError', { error: 'Failed to fetch department users' });
        return;
      }
      
      const departmentUserIds = [...new Set(departmentUsers?.map(u => u.sys_user_id) || [])];
      
      // Add in-memory statuses (filtered by department)
      this.agentStatuses.forEach((agentData, userId) => {
        if (departmentUserIds.includes(userId)) {
          agentStatuses[userId] = {
            userId: agentData.userId,
            userType: agentData.userType,
            agentStatus: agentData.agentStatus,
            lastSeen: agentData.lastSeen
          };
        }
      });
      
      // Fetch agent statuses from database (filtered by department)
      try {
        const { data: agents, error } = await supabase
          .from('sys_user')
          .select('sys_user_id, agent_status, last_seen')
          .in('sys_user_id', departmentUserIds)
          .not('agent_status', 'is', null);
        
        if (!error && agents) {
          agents.forEach(agent => {
            // Only add if not already in memory (in-memory is more up-to-date)
            if (!agentStatuses[agent.sys_user_id]) {
              agentStatuses[agent.sys_user_id] = {
                userId: agent.sys_user_id,
                userType: 'agent',
                agentStatus: agent.agent_status || 'offline',
                lastSeen: agent.last_seen ? new Date(agent.last_seen) : new Date()
              };
            }
          });
        }
      } catch (dbError) {
        console.error('❌ Error fetching agent statuses from database:', dbError);
      }
      
      console.log(`📋 Returning ${Object.keys(agentStatuses).length} agent statuses for user ${requestingUserId}`);
      socket.emit('agentStatusesList', agentStatuses);
    } catch (error) {
      console.error('❌ Error handling get agent statuses:', error);
      socket.emit('agentStatusError', { error: 'Failed to get agent statuses' });
    }
  }

  /**
   * Get all agent statuses (in-memory + database)
   * Optionally filtered by department
   */
  async getAgentStatuses(departmentIds = null) {
    const statuses = {};
    
    // If department filtering is requested
    if (departmentIds && departmentIds.length > 0) {
      // Get users in specified departments
      const { data: departmentUsers, error: usersError } = await supabase
        .from('sys_user_department')
        .select('sys_user_id')
        .in('dept_id', departmentIds);
      
      if (usersError) {
        console.error('❌ Error fetching department users:', usersError);
        return statuses;
      }
      
      const departmentUserIds = [...new Set(departmentUsers?.map(u => u.sys_user_id) || [])];
      
      // Add in-memory statuses (filtered)
      this.agentStatuses.forEach((agentData, userId) => {
        if (departmentUserIds.includes(userId)) {
          statuses[userId] = agentData;
        }
      });
      
      // Fetch from database (filtered)
      try {
        const { data: agents, error } = await supabase
          .from('sys_user')
          .select('sys_user_id, agent_status, last_seen')
          .in('sys_user_id', departmentUserIds)
          .not('agent_status', 'is', null);
        
        if (!error && agents) {
          agents.forEach(agent => {
            if (!statuses[agent.sys_user_id]) {
              statuses[agent.sys_user_id] = {
                userId: agent.sys_user_id,
                userType: 'agent',
                agentStatus: agent.agent_status || 'offline',
                lastSeen: agent.last_seen ? new Date(agent.last_seen) : new Date(),
                socketId: null
              };
            }
          });
        }
      } catch (dbError) {
        console.error('❌ Error fetching agent statuses from database:', dbError);
      }
    } else {
      // No filtering - return all (original behavior)
      // Add in-memory statuses
      this.agentStatuses.forEach((agentData, userId) => {
        statuses[userId] = agentData;
      });
      
      // Fetch from database to include offline agents
      try {
        const { data: agents, error } = await supabase
          .from('sys_user')
          .select('sys_user_id, agent_status, last_seen')
          .not('agent_status', 'is', null);
        
        if (!error && agents) {
          agents.forEach(agent => {
            // Only add if not already in memory
            if (!statuses[agent.sys_user_id]) {
              statuses[agent.sys_user_id] = {
                userId: agent.sys_user_id,
                userType: 'agent',
                agentStatus: agent.agent_status || 'offline',
                lastSeen: agent.last_seen ? new Date(agent.last_seen) : new Date(),
                socketId: null
              };
            }
          });
        }
      } catch (dbError) {
        console.error('❌ Error fetching agent statuses from database:', dbError);
      }
    }

    return statuses;
  }

  /**
   * Check for idle agents and set them offline
   * Called periodically by a manager
   * Aligned with token lifecycle: 12 minutes (matches auto-refresh interval)
   */
  async checkIdleAgents() {
    const now = new Date();
    const idleThreshold = 12 * 60 * 1000; // 12 minutes (matches token auto-refresh)

    for (const [userId, agentData] of this.agentStatuses.entries()) {
      const idleTime = now - agentData.lastSeen;
      
      if (idleTime >= idleThreshold && agentData.agentStatus !== 'offline') {
        console.log(`😴 Agent ${userId} idle for ${Math.floor(idleTime / 60000)} minutes, setting offline`);
        await this.setAgentOffline(userId);
      }
    }
  }

  /**
   * Assign queued chats to newly available agent
   */
  async assignQueuedChatsToNewAgent(agentId) {
    try {
      const agentAssignmentService = require('../../services/agentAssignment.service');
      const assignedChats = await agentAssignmentService.assignQueuedChatsToAgent(agentId);

      if (assignedChats.length > 0) {
        console.log(`✅ Assigned ${assignedChats.length} queued chats to agent ${agentId}`);

        // Get the notifier from socket config
        if (this.io.socketConfig) {
          const notifier = this.io.socketConfig.getChatGroupNotifier();
          if (notifier) {
            notifier.notifyQueuedChatsAssigned(assignedChats, agentId);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error assigning queued chats to new agent:', error);
    }
  }

  /**
   * Cleanup rate limits
   */
  async cleanupRateLimits() {
    const now = new Date();
    const staleThreshold = 300000; // 5 minutes

    for (const [userId, lastHeartbeat] of this.rateLimits.entries()) {
      if (now - lastHeartbeat > staleThreshold) {
        this.rateLimits.delete(userId);
      }
    }
  }
}

module.exports = AgentStatusHandler;
