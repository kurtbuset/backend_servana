const chatController = require('../controllers/chat.controller');
const RoomAccess = require('./authorization/roomAccess');
const MessageAuth = require('./authorization/messageAuth');

/**
 * Socket event handlers for chat functionality
 */
class SocketHandlers {
  constructor(io) {
    this.io = io;
    this.roomAccess = new RoomAccess();
    this.messageAuth = new MessageAuth();
  }

  /**
   * Handle user joining a chat group
   */
  async handleJoinChatGroup(socket, data) {
    try {
      const { groupId, userType, userId } = data;
      
      // Validate that socket is authenticated
      if (!socket.isAuthenticated || !socket.user) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      // Check room access authorization
      const roomAccess = await this.roomAccess.canJoinRoom(socket.user, groupId);
      if (!roomAccess.allowed) {
        socket.emit('error', { 
          message: 'Access denied', 
          reason: roomAccess.reason 
        });
        return;
      }

      // Leave previous room if agent was in another room
      if (socket.chatGroupId && socket.chatGroupId !== groupId) {
        socket.leave(String(socket.chatGroupId));
        
        // Notify previous room that agent left
        socket.to(String(socket.chatGroupId)).emit('userLeft', {
          userType: socket.user.userType,
          userId: socket.user.userId,
          chatGroupId: socket.chatGroupId
        });
        
      }
      
      // Join new room
      socket.join(String(groupId));
      socket.chatGroupId = groupId;
      
      // Notify new room that user joined
      socket.to(String(groupId)).emit('userJoined', {
        userType: socket.user.userType,
        userId: socket.user.userId,
        chatGroupId: groupId
      });

      // Send success confirmation
      socket.emit('joinedRoom', {
        chatGroupId: groupId,
        roomInfo: roomAccess.roomInfo
      });
    } catch (error) {
      console.error('❌ Error in handleJoinChatGroup:', error.message);
      socket.emit('error', { 
        message: 'Failed to join chat group',
        details: error.message 
      });
    }
  }

  /**
   * Handle explicit room leaving
   */
  handleLeavePreviousRoom(socket) {
    if (!socket.isAuthenticated || !socket.user) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    if (socket.chatGroupId) {
      socket.leave(String(socket.chatGroupId));
      
      // Notify room that user left
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: socket.user.userType,
        userId: socket.user.userId,
        chatGroupId: socket.chatGroupId
      });
      
      // Clear room info from socket
      socket.chatGroupId = null;
    }
  }

  /**
   * Handle specific room leaving
   */
  handleLeaveRoom(socket, data) {
    // Handle both old format (just roomId) and new format (object with roomId, userType, userId)
    let roomId, userType, userId;
    
    if (typeof data === 'object' && data.roomId) {
      // New format: { roomId, userType, userId }
      roomId = data.roomId;
      userType = data.userType || socket.userType || 'unknown';
      userId = data.userId || socket.userId || 'unknown';
    } else {
      // Old format: just roomId string/number
      roomId = data;
      userType = socket.userType || 'unknown';
      userId = socket.userId || 'unknown';
    }
    
    socket.leave(String(roomId));
    
    // Notify room that user left with proper user info
    socket.to(String(roomId)).emit('userLeft', {
      userType: userType,
      userId: userId,
      chatGroupId: roomId
    });
    
  }

  /**
   * Handle typing events
   */
  handleTyping(socket, data) {
    const { chat_group_id, userName, userId } = data;
    // Broadcast to all users in the chat group except sender
    socket.to(chat_group_id).emit('userTyping', {
      userName: userName || 'Someone',
      userId,
      isCurrentUser: false,
    });
  }

  /**
   * Handle stop typing events
   */
  handleStopTyping(socket, data) {
    const { chat_group_id } = data;
    socket.to(chat_group_id).emit('userStoppedTyping');
  }

  /**
   * Handle sending messages
   */
  async handleSendMessage(socket, messageData) {
    try {
      // Validate authentication
      if (!socket.isAuthenticated || !socket.user) {
        socket.emit('messageError', { 
          error: 'Authentication required',
          tempId: messageData.tempId 
        });
        return;
      }

      // Authorize message sending
      const authResult = await this.messageAuth.authorizeSendMessage(socket.user, messageData);
      
      if (!authResult.authorized) {
        socket.emit('messageError', { 
          error: 'Message authorization failed',
          details: authResult.reason,
          tempId: messageData.tempId 
        });
        return;
      }

      const roomId = String(messageData.chat_group_id);
      const sanitizedMessage = authResult.sanitizedMessage;
      
      // Determine sender type
      const isAgent = socket.user.userType === 'agent';
      const isClient = socket.user.userType === 'client';
      
      // Save message to database
      const savedMessage = await chatController.handleSendMessage(sanitizedMessage, this.io, socket);
      
      if (savedMessage) {
        // Get sender's profile image
        let senderImage = null;
        if (socket.user.profId) {
          const chatService = require('../services/chat.service');
          const profileImages = await chatService.getProfileImages([socket.user.profId]);
          senderImage = profileImages[socket.user.profId] || null;
        }

        // Standardized message format for broadcasting
        const broadcastMessage = {
          ...savedMessage,
          sender_type: socket.user.userType,
          sender_id: socket.user.userId,
          sender_name: socket.user.firstName && socket.user.lastName 
            ? `${socket.user.firstName} ${socket.user.lastName}`.trim()
            : socket.user.userType === 'client' ? 'Client' : 'Agent',
          sender_image: senderImage
        };
        
        // Broadcast to room
        this.io.to(roomId).emit('receiveMessage', broadcastMessage);
        
        // Send delivery confirmation to sender
        socket.emit('messageDelivered', {
          chat_id: savedMessage.chat_id,
          chat_group_id: messageData.chat_group_id,
          timestamp: savedMessage.chat_created_at,
          tempId: messageData.tempId
        });

        // Handle real-time customer list sorting
        await this.handleCustomerListUpdate(savedMessage, socket.user.userType);
        
      }
    } catch (error) {
      console.error('❌ Error handling sendMessage:', error);
      socket.emit('messageError', { 
        error: 'Failed to send message',
        details: error.message,
        chat_group_id: messageData.chat_group_id,
        tempId: messageData.tempId
      });
    }
  }

  /**
   * Handle real-time customer list updates when messages are sent
   */
  async handleCustomerListUpdate(savedMessage, senderType) {
    try {
      // Only update customer lists when clients send messages
      // (agents sending messages don't change the customer order priority)
      if (senderType !== 'client') {
        return;
      }

      // Get chat group and department information
      const chatGroupInfo = await this.getChatGroupInfo(savedMessage.chat_group_id);
      if (!chatGroupInfo) {
        console.error('❌ Could not find chat group info for customer list update');
        return;
      }

      // Get client information for the update
      const clientInfo = await this.getClientInfo(chatGroupInfo.client_id);
      if (!clientInfo) {
        console.error('❌ Could not find client info for customer list update');
        return;
      }

      // Prepare customer update data
      const customerUpdate = {
        chat_group_id: savedMessage.chat_group_id,
        client_id: chatGroupInfo.client_id,
        timestamp: savedMessage.chat_created_at,
        department_id: chatGroupInfo.dept_id,
        customer: {
          id: clientInfo.client_id,
          chat_group_id: savedMessage.chat_group_id,
          name: clientInfo.name,
          number: clientInfo.client_number,
          profile: clientInfo.profile_image,
          time: new Date(savedMessage.chat_created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          status: chatGroupInfo.status,
          department: chatGroupInfo.department?.dept_name || 'Unknown', // Add department name
        }
      };

      // Emit to agents in the same department
      await this.notifyDepartmentAgents(chatGroupInfo.dept_id, customerUpdate);

    } catch (error) {
      console.error('❌ Error handling customer list update:', error);
    }
  }

  /**
   * Get chat group information including department
   */
  async getChatGroupInfo(chatGroupId) {
    try {
      const supabase = require('../helpers/supabaseClient');
      
      const { data: chatGroup, error } = await supabase
        .from('chat_group')
        .select(`
          chat_group_id,
          client_id,
          dept_id,
          sys_user_id,
          status,
          department:dept_id (
            dept_id,
            dept_name
          )
        `)
        .eq('chat_group_id', chatGroupId)
        .single();

      if (error || !chatGroup) {
        throw new Error('Chat group not found');
      }

      return chatGroup;
    } catch (error) {
      console.error('❌ Error getting chat group info:', error);
      return null;
    }
  }

  /**
   * Get client information including profile
   */
  async getClientInfo(clientId) {
    try {
      const supabase = require('../helpers/supabaseClient');
      
      const { data: client, error } = await supabase
        .from('client')
        .select(`
          client_id,
          client_number,
          prof_id,
          profile:prof_id (
            prof_firstname,
            prof_lastname
          )
        `)
        .eq('client_id', clientId)
        .single();

      if (error || !client) {
        throw new Error('Client not found');
      }

      // Get profile image
      let profileImage = null;
      if (client.prof_id) {
        const { data: image } = await supabase
          .from('image')
          .select('img_location')
          .eq('prof_id', client.prof_id)
          .eq('img_is_current', true)
          .single();
        
        profileImage = image?.img_location || null;
      }

      const fullName = client.profile
        ? `${client.profile.prof_firstname} ${client.profile.prof_lastname}`.trim()
        : "Unknown Client";

      return {
        client_id: client.client_id,
        client_number: client.client_number,
        name: fullName,
        profile_image: profileImage
      };
    } catch (error) {
      console.error('❌ Error getting client info:', error);
      return null;
    }
  }

  /**
   * Notify agents in the same department about customer list updates
   */
  async notifyDepartmentAgents(departmentId, customerUpdate) {
    try {
      const supabase = require('../helpers/supabaseClient');
      
      // Get all agents in this department
      const { data: departmentAgents, error } = await supabase
        .from('sys_user_department')
        .select(`
          sys_user_id,
          sys_user:sys_user_id (
            sys_user_id,
            sys_user_is_active
          )
        `)
        .eq('dept_id', departmentId);

      if (error || !departmentAgents) {
        console.error('❌ Error getting department agents:', error);
        return;
      }

      // Create department room name
      const departmentRoom = `department_${departmentId}`;
      
      // Emit customer list update to department room
      this.io.to(departmentRoom).emit('customerListUpdate', {
        type: 'move_to_top',
        data: customerUpdate
      });

      // Also emit to individual agent rooms as fallback
      departmentAgents.forEach(agent => {
        if (agent.sys_user?.is_active) {
          const agentRoom = `agent_${agent.sys_user_id}`;
          this.io.to(agentRoom).emit('customerListUpdate', {
            type: 'move_to_top',
            data: customerUpdate
          });
        }
      });

    } catch (error) {
      console.error('❌ Error notifying department agents:', error);
    }
  }

  /**
   * Handle user disconnection
   */
  handleDisconnect(socket) {
    // Notify room members about user leaving
    if (socket.chatGroupId && socket.userType) {
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: socket.userType,
        userId: socket.userId,
        chatGroupId: socket.chatGroupId
      });
    }
  }
}

module.exports = SocketHandlers;