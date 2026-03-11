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
    const chatGroupHelper = require('../helpers/chat-group.helper');
    const clientHelper = require('../helpers/client.helper');

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
   * Notify when an agent manually accepts a queued chat
   * @param {Object} chatGroupDetails - Chat group details
   * @param {number} agentId - Agent ID who accepted the chat
   */
  async notifyChatAccepted(chatGroupDetails, agentId) {
    console.log('reached notifyChatAccepted')
    if (!this.io) {
      console.error('❌ Socket.IO instance not set in ChatGroupNotifier');
      return;
    }

    console.log(`✅ Agent ${agentId} accepted chat ${chatGroupDetails.chat_group_id}`);

    try {
      const client = chatGroupDetails.client;
      const department = chatGroupDetails.department;

      if (!client || !department) {
        console.error('❌ Missing client or department info for chat acceptance notification');
        return;
      }

      const fullName = client.profile
        ? `${client.profile.prof_firstname} ${client.profile.prof_lastname}`.trim()
        : "Unknown Client";

      // Get profile image
      // let profileImage = null;
      // if (client.prof_id) {
      //   const { data: images } = await require('../helpers/supabaseClient')
      //     .from("image")
      //     .select("img_location, img_is_current")
      //     .eq("prof_id", client.prof_id)
      //     .order("img_is_current", { ascending: false })
      //     .limit(1);
        
      //   if (images && images.length > 0) {
      //     profileImage = images[0].img_location;
      //   }
      // }

      const customerUpdate = {
        chat_group_id: chatGroupDetails.chat_group_id,
        client_id: chatGroupDetails.client_id,
        timestamp: new Date().toISOString(),
        department_id: chatGroupDetails.dept_id,
        customer: {
          id: client.client_id,
          chat_group_id: chatGroupDetails.chat_group_id,
          name: fullName,
          number: client.client_number,
          // profile: profileImage,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          status: 'active',
          chat_type: 'active',
          sys_user_id: agentId,
          department: department.dept_name || 'Unknown',
        }
      };

      // Emit to the agent who accepted - show as active chat
      // for notifying the client in mobile
      this.io.to(`agent_${agentId}`).emit('customerListUpdate', {
        type: 'chat_accepted',
        data: customerUpdate
      });

      // Emit to ALL agents in department to remove from their queue/list
      this.io.to(`department_${chatGroupDetails.dept_id}`).emit('customerListUpdate', {
        type: 'remove_chat_group',
        data: {
          chat_group_id: chatGroupDetails.chat_group_id,
          accepted_by: agentId,
          department_id: chatGroupDetails.dept_id
        }
      }); 

      console.log('chat removed from the queue')

      // console.log(`📡 Chat acceptance notification sent for chat ${chatGroupDetails.chat_group_id}`);
    } catch (error) {
      console.error(`❌ Error sending chat acceptance notification:`, error);
    }
  }
  /**
   * Notify when a chat is transferred to another department
   * @param {Object} transferDetails - Transfer details
   * @param {number} transferDetails.chat_group_id - Chat group ID
   * @param {number} transferDetails.old_dept_id - Previous department ID
   * @param {number} transferDetails.new_dept_id - New department ID
   * @param {number} transferDetails.client_id - Client ID
   * @param {number} transferDetails.transferred_by - Agent ID who transferred
   */
  async notifyChatTransferred(transferDetails) {
    if (!this.io) {
      console.error('❌ Socket.IO instance not set in ChatGroupNotifier');
      return;
    }

    console.log(`✅ Chat ${transferDetails.chat_group_id} transferred from dept ${transferDetails.old_dept_id} to dept ${transferDetails.new_dept_id}`);

    try {
      const chatGroupHelper = require('../helpers/chat-group.helper');
      const clientHelper = require('../helpers/client.helper');

      const chatGroupInfo = await chatGroupHelper.getChatGroupInfo(transferDetails.chat_group_id);
      const clientInfo = await clientHelper.getClientInfo(transferDetails.client_id);

      if (!chatGroupInfo || !clientInfo) {
        console.error('❌ Missing chat group or client info for transfer notification');
        return;
      }

      // Emit to old department - remove from their lists
      this.io.to(`department_${transferDetails.old_dept_id}`).emit('customerListUpdate', {
        type: 'chat_transferred_out',
        data: {
          chat_group_id: transferDetails.chat_group_id,
          new_dept_id: transferDetails.new_dept_id,
          transferred_by: transferDetails.transferred_by
        }
      });

      // Emit to new department - add to their queue
      const timestamp = new Date();
      const customerUpdate = {
        chat_group_id: transferDetails.chat_group_id,
        client_id: transferDetails.client_id,
        timestamp: timestamp.toISOString(),
        department_id: transferDetails.new_dept_id,
        customer: {
          id: clientInfo.client_id,
          chat_group_id: transferDetails.chat_group_id,
          name: clientInfo.name,
          number: clientInfo.client_number,
          profile: clientInfo.profile_image,
          time: timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          status: 'transferred',
          chat_type: 'queued',
          department: chatGroupInfo.department?.dept_name || 'Unknown',
          created_at: timestamp.toISOString(),
        }
      };

      this.io.to(`department_${transferDetails.new_dept_id}`).emit('customerListUpdate', {
        type: 'chat_transferred_in',
        data: customerUpdate
      });

      console.log(`📡 Chat transfer notification sent for chat ${transferDetails.chat_group_id}`);
    } catch (error) {
      console.error(`❌ Error sending chat transfer notification:`, error);
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
  async _notifyChatQueued(chatData) {
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

    // Emit customerListUpdate to agents in the department
    try {
      const chatGroupHelper = require('../helpers/chat-group.helper');
      const clientHelper = require('../helpers/client.helper');

      const chatGroupInfo = await chatGroupHelper.getChatGroupInfo(chatData.chat_group_id);
      const clientInfo = await clientHelper.getClientInfo(chatData.client_id);

      if (chatGroupInfo && clientInfo) {
        const customerUpdate = {
          chat_group_id: chatData.chat_group_id,
          client_id: chatData.client_id,
          timestamp: timestamp.toISOString(),
          department_id: chatGroupInfo.dept_id,
          customer: {
            id: clientInfo.client_id,
            chat_group_id: chatData.chat_group_id,
            name: clientInfo.name,
            number: clientInfo.client_number,
            profile: clientInfo.profile_image,
            time: timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            status: 'queued',
            chat_type: 'queued',
            department: chatGroupInfo.department?.dept_name || 'Unknown',
            created_at: timestamp.toISOString(),
          }
        };

        // Emit to all agents in the department
        this.io.to(`department_${chatData.dept_id}`).emit('customerListUpdate', {
          type: 'new_queued_chat',
          data: customerUpdate
        });

        console.log(`📡 Customer list update sent to department ${chatData.dept_id} for new queued chat ${chatData.chat_group_id}`);
      }
    } catch (error) {
      console.error(`❌ Error sending customerListUpdate for queued chat ${chatData.chat_group_id}:`, error);
    }
  }
}

module.exports = ChatGroupNotifier;
