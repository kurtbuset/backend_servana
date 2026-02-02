const socketIo = require('socket.io');
const SocketHandlers = require('./socketHandlers');
const UserStatusHandlers = require('./userStatusHandlers');
const UserStatusManager = require('./userStatusManager');

/**
 * Socket.IO configuration and setup
 */
class SocketConfig {
  constructor(server, allowedOrigins) {
    this.server = server;
    this.allowedOrigins = allowedOrigins;
    this.io = null;
    this.handlers = null;
    this.userStatusHandlers = null;
    this.userStatusManager = null;
  }

  /**
   * Initialize Socket.IO with configuration
   */
  initialize() {
    this.io = socketIo(this.server, {
      cors: {
        origin: this.allowedOrigins,
        credentials: true,
      }
    });

    this.handlers = new SocketHandlers(this.io);
    this.userStatusHandlers = new UserStatusHandlers(this.io);
    this.userStatusManager = new UserStatusManager(this.io, this.userStatusHandlers);
    
    this.setupEventListeners();
    this.userStatusManager.start();
    
    return this.io;
  }

  /**
   * Setup socket event listeners
   */
  setupEventListeners() {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.id}`);
      
      // User status events
      socket.on('userOnline', async (data) => {
        await this.userStatusHandlers.handleUserOnline(socket, data);
      });

      socket.on('userHeartbeat', async (data) => {
        await this.userStatusHandlers.handleUserHeartbeat(socket, data);
      });

      socket.on('userOffline', async (data) => {
        await this.userStatusHandlers.handleUserOffline(socket, data);
      });

      socket.on('getOnlineUsers', () => {
        this.userStatusHandlers.handleGetOnlineUsers(socket);
      });

      // Chat events
      socket.on('joinChatGroup', (data) => {
        this.handlers.handleJoinChatGroup(socket, data);
      });

      socket.on('leavePreviousRoom', () => {
        this.handlers.handleLeavePreviousRoom(socket);
      });

      socket.on('leaveRoom', (data) => {
        this.handlers.handleLeaveRoom(socket, data);
      });

      // Typing events
      socket.on('typing', (data) => {
        this.handlers.handleTyping(socket, data);
      });

      socket.on('stopTyping', (data) => {
        this.handlers.handleStopTyping(socket, data);
      });

      // Message handling
      socket.on('sendMessage', async (messageData) => {
        await this.handlers.handleSendMessage(socket, messageData);
      });

      // Disconnection
      socket.on('disconnect', async () => {
        await this.userStatusHandlers.handleUserDisconnect(socket);
        this.handlers.handleDisconnect(socket);
      });
    });
  }

  /**
   * Get the Socket.IO instance
   */
  getIO() {
    return this.io;
  }

  /**
   * Get user status handlers
   */
  getUserStatusHandlers() {
    return this.userStatusHandlers;
  }

  /**
   * Get user status manager
   */
  getUserStatusManager() {
    return this.userStatusManager;
  }

  /**
   * Cleanup and stop all services
   */
  cleanup() {
    if (this.userStatusManager) {
      this.userStatusManager.stop();
    }
  }
}

module.exports = SocketConfig;