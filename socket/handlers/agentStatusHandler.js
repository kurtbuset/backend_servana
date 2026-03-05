const supabase = require('../../helpers/supabaseClient');

/**
 * Agent Status Handler
 * Handles agent status updates (accepting_chats, not_accepting_chats, offline)
 */
class AgentStatusHandler {
  constructor(io) {
    this.io = io;
  }

  /**
   * Handle agent status update via Socket.IO
   */
  async handleUpdateAgentStatus(socket, data) {
    try {
      const { agent_status } = data;
      const userId = socket.user?.userId;

      if (!userId) {
        socket.emit('error', { message: 'User not authenticated' });
        return;
      }

      const validStatuses = ['accepting_chats', 'not_accepting_chats', 'offline'];
      if (!agent_status || !validStatuses.includes(agent_status)) {
        socket.emit('error', { message: 'Invalid agent_status' });
        return;
      }

      // Update agent status in database
      const { error } = await supabase
        .from('sys_user')
        .update({ 
          agent_status,
          sys_user_updated_at: new Date().toISOString()
        })
        .eq('sys_user_id', userId);

      if (error) {
        console.error('❌ Error updating agent status:', error);
        socket.emit('error', { message: 'Failed to update agent status' });
        return;
      }

      // Broadcast to all clients
      this.io.emit('agentStatusChanged', {
        userId,
        agent_status,
        timestamp: new Date()
      });

      console.log(`📡 Agent status updated via Socket.IO: ${userId} -> ${agent_status}`);

      // If agent is now accepting chats, assign queued chats
      if (agent_status === 'accepting_chats') {
        await this.assignQueuedChatsToNewAgent(userId);
      }
    } catch (error) {
      console.error('❌ Error in handleUpdateAgentStatus:', error);
      socket.emit('error', { message: 'Server error updating agent status' });
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
}

module.exports = AgentStatusHandler;
