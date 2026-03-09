const socketIo = require('socket.io');
const SocketAuthMiddleware = require('./middleware/socketAuth');
const UserStatusManager = require('./userStatusManager');
const RoomManagementService = require('./services/roomManagementService');
const { ChatGroupNotifier } = require('./notifications');

// Import handlers
const {
  ChatRoomHandler,
  TypingHandler,
  MessageHandler,
  UserStatusHandler,
  AgentStatusHandler
} = require('./handlers');

// Import events
const {
  ChatEvents,
  UserStatusEvents,
  AgentStatusEvents
} = require('./events');

/**
 * Socket.IO configuration and setup
 */
class SocketConfig {
  constructor(server, allowedOrigins) {
    this.server = server;
    this.allowedOrigins = allowedOrigins;
    this.io = null;
    this.authMiddleware = new SocketAuthMiddleware();
    
    // Handlers
    this.chatRoomHandler = null;
    this.typingHandler = null;
    this.messageHandler = null;
    this.userStatusHandler = null;
    this.agentStatusHandler = null;
    
    // Events
    this.chatEvents = null;
    this.userStatusEvents = null;
    this.agentStatusEvents = null;
    
    // Manager
    this.userStatusManager = null;
    
    // Notifiers
    this.chatGroupNotifier = null;
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

    // Store reference to config on io instance for access from controllers
    this.io.socketConfig = this;

    // Add authentication middleware
    this.io.use((socket, next) => {
      this.authMiddleware.authenticate(socket, next);
    });

    // Initialize handlers
    this.chatRoomHandler = new ChatRoomHandler(this.io);
    this.typingHandler = new TypingHandler(this.io);
    this.messageHandler = new MessageHandler(this.io);
    this.userStatusHandler = new UserStatusHandler(this.io);
    this.agentStatusHandler = new AgentStatusHandler(this.io);
    
    // Initialize events
    this.chatEvents = new ChatEvents(
      this.chatRoomHandler,
      this.typingHandler,
      this.messageHandler
    );
    this.userStatusEvents = new UserStatusEvents(this.userStatusHandler);
    this.agentStatusEvents = new AgentStatusEvents(this.agentStatusHandler);
    
    // Initialize manager
    this.userStatusManager = new UserStatusManager(this.io, this.userStatusHandler);
    
    // Initialize notifiers
    this.chatGroupNotifier = new ChatGroupNotifier(this.io);
    
    this.setupEventListeners();
    this.userStatusManager.start();
    
    return this.io;
  }

  /**
   * Setup socket event listeners
   */
  setupEventListeners() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 New socket connection: ${socket.id}`);

      // Register user status events
      this.userStatusEvents.register(socket);
      
      // Register agent status events
      this.agentStatusEvents.register(socket);
      
      // Register chat events
      this.chatEvents.register(socket);

      // Handle user coming online - join department rooms for agents
      socket.on('userOnline', async (data) => {
        await this.userStatusHandler.handleUserOnline(socket, data);
        
        // Join department rooms for agents
        if (socket.user && socket.user.userType === 'agent') {
          await RoomManagementService.joinDepartmentRooms(socket);
        }
      });

      // Disconnection
      socket.on('disconnect', async () => {
        await this.userStatusHandler.handleUserDisconnect(socket);
        this.chatRoomHandler.handleDisconnect(socket);
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
   * Get user status handler
   */
  getUserStatusHandler() {
    return this.userStatusHandler;
  }

  /**
   * Get user status manager
   */
  getUserStatusManager() {
    return this.userStatusManager;
  }

  /**
   * Get chat group notifier
   */
  getChatGroupNotifier() {
    return this.chatGroupNotifier;
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