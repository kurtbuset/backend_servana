/**
 * Chat Event Handlers
 * Handles all chat-related socket events (join, leave, typing, messages)
 */
class ChatEvents {
  constructor(chatHandler, typingHandler, messageHandler) {
    this.chatHandler = chatHandler;
    this.typingHandler = typingHandler;
    this.messageHandler = messageHandler;
  }

  /**
   * Register all chat event listeners
   * @param {Object} socket - Socket instance
   */
  register(socket) {
    // Chat room events
    socket.on('joinChatGroup', async (data) => {
      await this.chatHandler.handleJoinChatGroup(socket, data);
    });

    socket.on('leavePreviousRoom', () => {
      this.chatHandler.handleLeavePreviousRoom(socket);
    });

    socket.on('leaveRoom', (data) => {
      this.chatHandler.handleLeaveRoom(socket, data);
    });

    // Typing events
    socket.on('typing', async (data) => {
      await this.typingHandler.handleTyping(socket, data);
    });

    socket.on('stopTyping', (data) => {
      this.typingHandler.handleStopTyping(socket, data);
    });

    // Message events
    socket.on('sendMessage', async (messageData) => {
      await this.messageHandler.handleSendMessage(socket, messageData);
    });
  }
}

module.exports = ChatEvents;
