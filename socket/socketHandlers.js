const chatController = require('../controllers/chat.controller');

/**
 * Socket event handlers for chat functionality
 */
class SocketHandlers {
  constructor(io) {
    this.io = io;
  }

  /**
   * Handle user joining a chat group
   */
  handleJoinChatGroup(socket, data) {
    const { groupId, userType, userId } = data;
    
    // Leave previous room if agent was in another room
    if (socket.chatGroupId && socket.chatGroupId !== groupId) {
      socket.leave(String(socket.chatGroupId));
      
      // Notify previous room that agent left
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: socket.userType,
        userId: socket.userId,
        chatGroupId: socket.chatGroupId
      });
      
      console.log(`${userType} ${userId} left chat_group ${socket.chatGroupId}`);
    }
    
    // Join new room
    socket.join(String(groupId));
    socket.chatGroupId = groupId;
    socket.userType = userType;
    socket.userId = userId;
    
    console.log(`${userType} ${userId} joined chat_group ${groupId}`);
    
    // Notify new room that user joined
    socket.to(String(groupId)).emit('userJoined', {
      userType,
      userId,
      chatGroupId: groupId
    });
  }

  /**
   * Handle explicit room leaving
   */
  handleLeavePreviousRoom(socket) {
    if (socket.chatGroupId) {
      socket.leave(String(socket.chatGroupId));
      
      // Use fallback values to avoid "undefined undefined"
      const userType = socket.userType || 'agent';
      const userId = socket.userId || 'unknown';
      
      // Notify room that agent left
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: userType,
        userId: userId,
        chatGroupId: socket.chatGroupId
      });
      
      console.log(`${userType} ${userId} left chat_group ${socket.chatGroupId}`);
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
    
    console.log(`${userType} ${userId} left chat_group ${roomId}`);
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
      const roomId = String(messageData.chat_group_id);
      
      // Determine sender type and validate message structure
      const isAgent = messageData.sys_user_id && !messageData.client_id;
      const isClient = messageData.client_id && !messageData.sys_user_id;
      
      if (!isAgent && !isClient) {
        throw new Error('Invalid message structure: must have either sys_user_id or client_id');
      }
      
      console.log(`📨 Message from ${isAgent ? 'agent' : 'client'}:`, {
        chat_group_id: messageData.chat_group_id,
        sender_id: isAgent ? messageData.sys_user_id : messageData.client_id,
        content_length: messageData.chat_body?.length || 0
      });
      
      // Save message to database for both agent and client
      const savedMessage = await chatController.handleSendMessage(messageData, this.io, socket);
      
      if (savedMessage) {
        // Standardized message format for broadcasting
        const broadcastMessage = {
          ...savedMessage,
          sender_type: isAgent ? 'agent' : 'client',
          sender_id: isAgent ? messageData.sys_user_id : messageData.client_id
        };
        
        // Single broadcast event for consistency
        this.io.to(roomId).emit('receiveMessage', broadcastMessage);
        
        // Send delivery confirmation to sender
        socket.emit('messageDelivered', {
          chat_id: savedMessage.chat_id,
          chat_group_id: messageData.chat_group_id,
          timestamp: savedMessage.chat_created_at,
          tempId: messageData.tempId // Include tempId for frontend confirmation
        });
        
        console.log(`✅ Message saved and broadcasted to chat_group ${messageData.chat_group_id}`);
      }
    } catch (error) {
      console.error('❌ Error handling sendMessage:', error);
      socket.emit('messageError', { 
        error: 'Failed to send message',
        details: error.message,
        chat_group_id: messageData.chat_group_id,
        tempId: messageData.tempId // Include tempId for frontend error handling
      });
    }
  }

  /**
   * Handle user disconnection
   */
  handleDisconnect(socket) {
    console.log(`❌ Client disconnected: ${socket.id}`);
    
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