const socketIo = require('socket.io');
const SocketAuthMiddleware = require('./middleware/socketAuth');
const AgentStatusManager = require('./agentStatusManager');
const RoomManagementService = require('./services/roomManagementService');
const { ChatGroupNotifier } = require('./notifications');

// Import handlers
const {
  ChatRoomHandler,
  TypingHandler,
  MessageHandler,
  AgentStatusHandler
} = require('./handlers');

// Import events
const {
  ChatEvents,
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
    
    // Managers
    this.userStatusManager = null;
    this.agentStatusManager = null;
    
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
      },
      // Mobile-optimized ping/pong settings
      pingInterval: 25000, // Send ping every 25 seconds (default)
      pingTimeout: 60000,  // Wait 60 seconds for pong (increased for mobile)
      // Total disconnect time: ~85 seconds (better for mobile backgrounding)
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
    
    this.agentStatusHandler = new AgentStatusHandler(this.io);
    
    // Initialize events
    this.chatEvents = new ChatEvents(
      this.chatRoomHandler,
      this.typingHandler,
      this.messageHandler
    );
    
    this.agentStatusEvents = new AgentStatusEvents(this.agentStatusHandler);
    
    // Initialize managers
    this.agentStatusManager = new AgentStatusManager(this.io, this.agentStatusHandler);
    
    // Initialize notifiers
    this.chatGroupNotifier = new ChatGroupNotifier(this.io);
    
    this.setupEventListeners();
    this.agentStatusManager.start();
    
    return this.io;
  }

  /**
   * Setup socket event listeners
   */
  setupEventListeners() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 New socket connection: ${socket.id}`);
      
      // Register agent status events
      this.agentStatusEvents.register(socket);
      
      // Register chat events
      this.chatEvents.register(socket);

      // Handle user coming online - join department rooms for agents
      socket.on('userOnline', async (data) => {
        // Join department rooms for agents
        if (socket.user && socket.user.userType === 'agent') {
          await RoomManagementService.joinDepartmentRooms(socket);
          
          // Also handle agent online status
          await this.agentStatusHandler.handleAgentOnline(socket, data);
        }
      });

      // Disconnection
      socket.on('disconnect', async () => {
        // Handle agent disconnect (don't set offline, just update last_seen)
        if (socket.user && socket.user.userType === 'agent') {
          await this.agentStatusHandler.handleAgentDisconnect(socket);
        }
        
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
   * Get agent status handler
   */
  getAgentStatusHandler() {
    return this.agentStatusHandler;
  }

  /**
   * Get agent status manager
   */
  getAgentStatusManager() {
    return this.agentStatusManager;
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
    if (this.agentStatusManager) {
      this.agentStatusManager.stop();
    }
  }
}

module.exports = SocketConfig;