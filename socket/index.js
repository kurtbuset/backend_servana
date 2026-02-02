const SocketConfig = require('./socketConfig');

/**
 * Socket module entry point
 * Provides a clean interface for initializing socket functionality
 */
function initializeSocket(server, allowedOrigins) {
  const socketConfig = new SocketConfig(server, allowedOrigins);
  return socketConfig.initialize();
}

module.exports = {
  initializeSocket,
  SocketConfig
};