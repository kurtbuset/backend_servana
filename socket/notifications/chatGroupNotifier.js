/**
 * Chat Group notification handler
 * Single source of truth for all chat assignment notifications
 */
class ChatGroupNotifier {
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
   * Notify about new chat group creation and assignment
   * @param {Object} result - Chat group creation result
   * @param {number} result.chat_group_id - Chat group ID
   * @param {boolean} result.assigned - Whether chat was assigned
   * @param {string} result.status - Chat status (active/queued)
   * @param {number} result.agent_id - Assigned agent ID (if assigned)
   * @param {number} departmentId - Department ID
   * @param {number} clientId - Client ID
   */
  notifyChatGroupCreated(result, departmentId, clientId) {
    if (!this.io) {
      console.error('❌ Socket.IO instance not set in ChatGroupNotifier');
      return;
    }

    if (result.assigned) {
      this._notifyChatAssignment({
        chat_group_id: result.chat_group_id,
        dept_id: departmentId,
        agent_id: result.agent_id,
        client_id: clientId,
        status: result.status
      }, 'created');
    } else {
      this._notifyChatQueued({
        chat_group_id: result.chat_group_id,
        dept_id: departmentId,
        client_id: clientId,
        status: result.status
      });
    }
  }

  /**
   * Notify about queued chats being assigned to an agent
   * @param {Array} assignedChats - Array of chat groups that were assigned
   * @param {number} agentId - Agent ID who received the assignments
   */
  async notifyQueuedChatsAssigned(assignedChats, agentId) {
    if (!this.io) {
      console.error('❌ Socket.IO instance not set in ChatGroupNotifier');
      return;
    }

    if (!assignedChats || assignedChats.length === 0) {
      return;
    }

    console.log(`✅ Broadcasting ${assignedChats.length} queued chat assignments to agent ${agentId}`);

    // Import helpers
    const chatGroupHelper = require('../helpers/chatGroupHelper');
    const clientHelper = require('../helpers/clientHelper');

    for (const chatGroup of assignedChats) {
      // Emit standard assignment notifications
      this._notifyChatAssignment({
        chat_group_id: chatGroup.chat_group_id,
        dept_id: chatGroup.dept_id,
        agent_id: agentId,
        client_id: chatGroup.client_id,
        status: chatGroup.status || 'active'
      }, 'assigned_from_queue');

      // Emit customerListUpdate to show the chat in agent's list
      try {
        const chatGroupInfo = await chatGroupHelper.getChatGroupInfo(chatGroup.chat_group_id);
        const clientInfo = await clientHelper.getClientInfo(chatGroup.client_id);

        if (chatGroupInfo && clientInfo) {
          const customerUpdate = {
            chat_group_id: chatGroup.chat_group_id,
            client_id: chatGroup.client_id,
            timestamp: new Date().toISOString(),
            department_id: chatGroupInfo.dept_id,
            customer: {
              id: clientInfo.client_id,
              chat_group_id: chatGroup.chat_group_id,
              name: clientInfo.name,
              number: clientInfo.client_number,
              profile: clientInfo.profile_image,
              time: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
              status: 'active',
              department: chatGroupInfo.department?.dept_name || 'Unknown',
            }
          };

          // Emit to the specific agent
          this.io.to(`agent_${agentId}`).emit('customerListUpdate', {
            type: 'new_assignment',
            data: customerUpdate
          });

          console.log(`📡 Customer list update sent to agent ${agentId} for newly assigned chat ${chatGroup.chat_group_id}`);
        }
      } catch (error) {
        console.error(`❌ Error sending customerListUpdate for chat ${chatGroup.chat_group_id}:`, error);
      }
    }
  }

  /**
   * Internal method: Notify about chat assignment (to agent)
   * @private
   */
  _notifyChatAssignment(chatData, action) {
    const timestamp = new Date();
    const payload = {
      chat_group_id: chatData.chat_group_id,
      dept_id: chatData.dept_id,
      agent_id: chatData.agent_id,
      client_id: chatData.client_id,
      status: chatData.status,
      action,
      timestamp
    };

    // Notify the agent
    this.io.to(`agent_${chatData.agent_id}`).emit('chatAssigned', {
      chat_group_id: payload.chat_group_id,
      dept_id: payload.dept_id,
      status: payload.status,
      action: payload.action,
      timestamp: payload.timestamp
    });

    // Notify the client
    if (chatData.client_id) {
      this.io.to(`client_${chatData.client_id}`).emit('agentAssigned', {
        chat_group_id: payload.chat_group_id,
        agent_id: payload.agent_id,
        status: payload.status,
        action: payload.action,
        timestamp: payload.timestamp
      });
    }

    // Notify department (chat removed from queue)
    if (chatData.dept_id) {
      this.io.to(`department_${chatData.dept_id}`).emit('chatDequeued', {
        chat_group_id: payload.chat_group_id,
        agent_id: payload.agent_id,
        status: payload.status,
        action: payload.action,
        timestamp: payload.timestamp
      });
    }

    console.log(`📡 Chat assignment: ${payload.chat_group_id} -> agent ${payload.agent_id} (${action})`);
  }

  /**
   * Internal method: Notify about chat being queued
   * @private
   */
  _notifyChatQueued(chatData) {
    const timestamp = new Date();
    const payload = {
      chat_group_id: chatData.chat_group_id,
      dept_id: chatData.dept_id,
      client_id: chatData.client_id,
      status: chatData.status,
      action: 'queued',
      timestamp
    };

    // Notify department (new chat in queue)
    if (chatData.dept_id) {
      this.io.to(`department_${chatData.dept_id}`).emit('chatQueued', payload);
    }

    console.log(`📡 Chat queued: ${payload.chat_group_id} in dept ${payload.dept_id}`);
  }
}

module.exports = ChatGroupNotifier;
