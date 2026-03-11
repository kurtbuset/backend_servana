const socketIo = require('socket.io');
const SocketAuthMiddleware = require('./middleware/socket.auth');
const AgentStatusManager = require('./agent-status.manager');
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

      // agentOnline event is handled in agentStatusEvents.js

      // Disconnection
      socket.on('disconnect', async (reason) => {
        const disconnectInfo = {
          socketId: socket.id,
          userId: socket.user?.userId,
          userType: socket.user?.userType,
          clientType: socket.clientType,
          reason: reason,
          timestamp: new Date().toISOString()
        };
        
        console.log(`🔌 Socket disconnected:`, disconnectInfo);
        
        // Handle different disconnect reasons
        switch (reason) {
          case 'io server disconnect':
            // Server forcefully disconnected (auth failure, manual kick)
            console.log(`🚨 Server initiated disconnect for ${socket.id}`);
            break;
            
          case 'io client disconnect':
            // Client called socket.disconnect()
            console.log(`ℹ️ Client initiated disconnect for ${socket.id}`);
            break;
            
          case 'ping timeout':
            // Client didn't respond to ping in time
            console.warn(`⏱️ Ping timeout for ${socket.id} - client unresponsive`);
            break;
            
          case 'transport close':
            // Underlying connection closed (network issue, server restart)
            console.warn(`🔌 Transport closed for ${socket.id} - network issue or server restart`);
            break;
            
          case 'transport error':
            // Transport error occurred
            console.error(`❌ Transport error for ${socket.id}`);
            break;
            
          default:
            console.log(`❓ Unknown disconnect reason for ${socket.id}: ${reason}`);
        }
        
        // Handle agent disconnect (don't set offline, just update last_seen)
        if (socket.user && socket.user.userType === 'agent') {
          await this.agentStatusHandler.handleAgentDisconnect(socket);
        }
        
        // Handle chat room cleanup
        this.chatRoomHandler.handleDisconnect(socket);
        
        // CRITICAL: Clean up all event listeners to prevent memory leaks
        socket.removeAllListeners();
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