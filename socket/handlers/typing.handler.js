const { BroadcastEmitter } = require('../emitters');

/**
 * Typing Handler
 * Handles typing indicator events
 */
class TypingHandler {
  constructor(io) {
    this.io = io;
  }

  /**
   * Handle typing events
   */
  async handleTyping(socket, data) {
    const { chatGroupId, userName, userId, userType } = data;
    const roomId = String(chatGroupId);
    
    // Get user's profile image
    let userImage = null;
    if (socket.user && socket.user.profId) {
      try {
        const chatService = require('../../services/chat.service');
        const profileImages = await chatService.getProfileImages([socket.user.profId]);
        userImage = profileImages[socket.user.profId] || null;
      } catch (error) {
        console.error('❌ Error getting profile image for typing:', error);
      }
    }
    
    // Broadcast to all users in the chat group except sender
    BroadcastEmitter.broadcastTyping(socket, roomId, {
      chatGroupId,
      userName: userName || 'Someone',
      userId,
      userType: userType || socket.user?.userType || 'unknown',
      userImage,
    });
  }

  /**
   * Handle stop typing events
   */
  handleStopTyping(socket, data) {
    const { chatGroupId, userId, userType } = data;
    const roomId = String(chatGroupId);
    
    BroadcastEmitter.broadcastStopTyping(socket, roomId, {
      chatGroupId,
      userId,
      userType: userType || socket.user?.userType || 'unknown',
    });
  }
}

module.exports = TypingHandler;
