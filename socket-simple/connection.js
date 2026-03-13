/**
 * Socket Connection Lifecycle Management
 * Handles connect, disconnect, and handshake events
 */

/**
 * Handle new socket connection
 */
function handleConnection(socket, io) {
  console.log(`✅ User ${socket.user.userId} (${socket.user.userType}) connected`);
  
  // Log connection details
  const connectionInfo = {
    socketId: socket.id,
    userId: socket.user.userId,
    userType: socket.user.userType,
    clientType: socket.clientType,
    ipAddress: socket.handshake.address,
    userAgent: socket.handshake.headers['user-agent'],
    connectedAt: socket.authenticatedAt
  };
  
  // Set up disconnect handler
  setupDisconnectHandler(socket);
  
  // Set up error handler
  setupErrorHandler(socket);
  
  // Optional: Track active connections
  trackActiveConnection(socket, io);
}

/**
 * Set up disconnect event handler
 */
function setupDisconnectHandler(socket) {
  socket.on('disconnect', (reason) => {
    const sessionInfo = {
      socketId: socket.id,
      userId: socket.user?.userId,
      userType: socket.user?.userType,
      clientType: socket.clientType,
      sessionDuration: socket.authenticatedAt ? Date.now() - socket.authenticatedAt.getTime() : 0,
      reason: reason
    };
    
    console.log(`❌ User ${socket.user?.userId} (${socket.user?.userType}) disconnected: ${reason}`);
    console.log('📊 Session info:', sessionInfo);
    
    // Leave all rooms
    if (socket.currentChatGroup) {
      socket.leave(`chat_${socket.currentChatGroup}`);
      console.log(`👋 Left chat group ${socket.currentChatGroup}`);
    }
    
    // Clean up socket data
    cleanupSocketData(socket);
    
    // Optional: Update user status to offline
    handleUserOffline(socket);
  });
}

/**
 * Set up error event handler
 */
function setupErrorHandler(socket) {
  socket.on('error', (error) => {
    console.error(`❌ Socket error for user ${socket.user?.userId}:`, {
      error: error.message,
      socketId: socket.id,
      userType: socket.user?.userType
    });
  });
}

/**
 * Clean up socket data on disconnect
 */
function cleanupSocketData(socket) {
  // Clear user context
  socket.user = null;
  socket.isAuthenticated = false;
  socket.clientType = null;
  socket.authenticatedAt = null;
  socket.currentChatGroup = null;
}

/**
 * Handle user going offline (optional)
 */
function handleUserOffline(socket) {
  if (socket.user?.userType === 'agent') {
    // Agent disconnect is handled by agent-status.js
    const { handleAgentDisconnect } = require('./agent-status');
    handleAgentDisconnect(socket, socket.server);
  }
}

/**
 * Track active connections (optional monitoring)
 */
function trackActiveConnection(socket, io) {
  // Log current connection count
  const connectionCount = io.sockets.sockets.size;
  console.log(`📈 Active connections: ${connectionCount}`);
  
  // Optional: Store connection in database or cache for monitoring
  // This could be useful for analytics or admin dashboards
}

/**
 * Handle connection errors at the engine level
 */
function setupGlobalErrorHandlers(io) {
  io.engine.on('connection_error', (err) => {
    console.error('❌ Socket.IO connection error:', {
      message: err.message,
      description: err.description,
      context: err.context,
      type: err.type,
      timestamp: new Date().toISOString()
    });
    
    // Handle specific connection errors
    if (err.message.includes('Authentication failed')) {
      console.error('🚨 Authentication failed - token may be expired');
    } else if (err.message.includes('xhr poll error')) {
      console.error('🚨 XHR poll error - cookie may have expired');
    }
  });
  
  // Monitor connection attempts
  io.engine.on('initial_headers', (headers, request) => {
    console.log('🔍 New connection attempt from:', request.socket.remoteAddress);
  });
}

/**
 * Get connection statistics
 */
function getConnectionStats(io) {
  const sockets = io.sockets.sockets;
  const stats = {
    total: sockets.size,
    agents: 0,
    clients: 0,
    web: 0,
    mobile: 0
  };
  
  sockets.forEach(socket => { 
    if (socket.user?.userType === 'agent') stats.agents++;
    if (socket.user?.userType === 'client') stats.clients++;
    if (socket.clientType === 'web') stats.web++;
    if (socket.clientType === 'mobile') stats.mobile++;
  });
  
  return stats;
}

module.exports = {
  handleConnection,
  setupDisconnectHandler,
  setupErrorHandler,
  setupGlobalErrorHandlers,
  getConnectionStats,
  cleanupSocketData,
  handleUserOffline
};