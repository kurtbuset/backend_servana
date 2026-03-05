const supabase = require('../../helpers/supabaseClient');

/**
 * Agent notification handler for customer list updates
 */
class AgentNotifier {
  constructor(io) {
    this.io = io;
  }

  /**
   * Set the Socket.IO instance
   * @param {Object} io - Socket.IO instance
   */
  setIO(io) {
    this.io = io;
  }

  /**
   * Notify agents in the same department about customer list updates
   * Only notifies the agent who has this chat assigned to them
   * @param {number} departmentId - Department ID
   * @param {Object} customerUpdate - Customer update data
   */
  async notifyDepartmentAgents(departmentId, customerUpdate) {
    try {
      if (!this.io) {
        console.error('❌ Socket.IO instance not set in AgentNotifier');
        return;
      }

      // Get the chat group to find the assigned agent
      const { data: chatGroup, error: chatError } = await supabase
        .from('chat_group')
        .select('sys_user_id, status')
        .eq('chat_group_id', customerUpdate.chat_group_id)
        .single();

      if (chatError || !chatGroup) {
        console.error('❌ Error getting chat group for notification:', chatError);
        return;
      }

      // Only notify if chat is assigned to a specific agent
      if (chatGroup.sys_user_id && chatGroup.status === 'active') {
        const agentRoom = `agent_${chatGroup.sys_user_id}`;
        
        // Emit customer list update only to the assigned agent
        this.io.to(agentRoom).emit('customerListUpdate', {
          type: 'move_to_top',
          data: customerUpdate
        });

        console.log(`📡 Customer list update sent to agent ${chatGroup.sys_user_id} for chat ${customerUpdate.chat_group_id}`);
      } else if (chatGroup.status === 'queued') {
        // If chat is queued, notify all agents in the department
        const departmentRoom = `department_${departmentId}`;
        
        this.io.to(departmentRoom).emit('customerListUpdate', {
          type: 'new_queued',
          data: customerUpdate
        });

        console.log(`📡 Queued chat update sent to department ${departmentId} for chat ${customerUpdate.chat_group_id}`);
      }

    } catch (error) {
      console.error('❌ Error notifying department agents:', error);
    }
  }
}

module.exports = AgentNotifier;
