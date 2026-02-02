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
        
        console.log(`${socket.user.userType} ${socket.user.userId} left chat_group ${socket.chatGroupId}`);
      }
      
      // Join new room
      socket.join(String(groupId));
      socket.chatGroupId = groupId;
      
      console.log(`${socket.user.userType} ${socket.user.userId} joined chat_group ${groupId}`);
      
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
      
      console.log(`${socket.user.userType} ${socket.user.userId} left chat_group ${socket.chatGroupId}`);
      
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
      
      console.log(`📨 Authorized message from ${socket.user.userType}:`, {
        chat_group_id: messageData.chat_group_id,
        sender_id: socket.user.userId,
        content_length: sanitizedMessage.chat_body?.length || 0
      });
      
      // Save message to database
      const savedMessage = await chatController.handleSendMessage(sanitizedMessage, this.io, socket);
      
      if (savedMessage) {
        // Standardized message format for broadcasting
        const broadcastMessage = {
          ...savedMessage,
          sender_type: socket.user.userType,
          sender_id: socket.user.userId
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
        
        console.log(`✅ Message saved and broadcasted to chat_group ${messageData.chat_group_id}`);
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