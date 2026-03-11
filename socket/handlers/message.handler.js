const chatController = require('../../controllers/chat.controller');
const MessageAuth = require('../authorization/message.auth');
const CustomerListService = require('../services/customer-list.service');
const EVENTS = require('../constants/events');
const { ResponseEmitter, BroadcastEmitter } = require('../emitters');

/**
 * Message Handler
 * Handles sending and receiving messages
 */
class MessageHandler {
  constructor(io) {
    this.io = io;
    this.messageAuth = new MessageAuth();
    this.customerListService = new CustomerListService(io);
  }

  /**
   * Handle sending messages
   */
  async handleSendMessage(socket, messageData) {
    try {
      // Validate authentication
      if (!socket.isAuthenticated || !socket.user) {
        ResponseEmitter.emitMessageError(socket, 'Authentication required', {
          chat_group_id: messageData.chat_group_id,
          tempId: messageData.tempId
        });
        return;
      }

      // Authorize message sending
      const authResult = await this.messageAuth.authorizeSendMessage(socket.user, messageData);
      
      if (!authResult.authorized) {
        ResponseEmitter.emitMessageError(socket, 'Message authorization failed', {
          chat_group_id: messageData.chat_group_id,
          tempId: messageData.tempId,
          details: authResult.reason
        });
        return;
      }

      const roomId = String(messageData.chat_group_id);
      const sanitizedMessage = authResult.sanitizedMessage;
      
      // Save message to database
      const savedMessage = await chatController.handleSendMessage(sanitizedMessage, this.io, socket);
      
      if (savedMessage) {
        // Get sender's profile image
        let senderImage = null;
        if (socket.user.profId) {
          const chatService = require('../../services/chat.service');
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
        BroadcastEmitter.broadcastMessage(this.io, roomId, broadcastMessage);
        
        // Send delivery confirmation to sender
        ResponseEmitter.emitMessageDelivered(socket, {
          chat_id: savedMessage.chat_id,
          chat_group_id: messageData.chat_group_id,
          timestamp: savedMessage.chat_created_at,
          tempId: messageData.tempId
        });

        // Handle real-time customer list sorting
        await this.customerListService.handleCustomerListUpdate(savedMessage, socket.user.userType);
      }
    } catch (error) {
      console.error('❌ Error handling sendMessage:', error);
      ResponseEmitter.emitMessageError(socket, 'Failed to send message', {
        chat_group_id: messageData.chat_group_id,
        tempId: messageData.tempId,
        details: error.message
      });
    }
  }
}

module.exports = MessageHandler;
