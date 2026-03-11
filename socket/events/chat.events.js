/**
 * Chat Event Handlers
 * Handles all chat-related socket events (join, leave, typing, messages)
 */
const EVENTS = require('../constants/events');

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
    socket.on(EVENTS.JOIN_CHAT_GROUP, async (data) => {
      await this.chatHandler.handleJoinChatGroup(socket, data);
    });

    socket.on(EVENTS.LEAVE_PREVIOUS_ROOM, () => {
      this.chatHandler.handleLeavePreviousRoom(socket);
    });

    socket.on(EVENTS.LEAVE_ROOM, (data) => {
      this.chatHandler.handleLeaveRoom(socket, data);
    });

    // Typing events
    socket.on(EVENTS.TYPING, async (data) => {
      await this.typingHandler.handleTyping(socket, data);
    });

    socket.on(EVENTS.STOP_TYPING, (data) => {
      this.typingHandler.handleStopTyping(socket, data);
    });

    // Message events
    socket.on(EVENTS.SEND_MESSAGE, async (messageData) => {
      await this.messageHandler.handleSendMessage(socket, messageData);
    });
  }
}

module.exports = ChatEvents;
