/**
 * Socket Manager
 * Handles periodic tasks and cleanup for socket operations
 */

const { checkIdleAgents, cleanupRateLimits } = require('./agent-status');

class SocketManager {
  constructor(io) {
    this.io = io;
    this.idleCheckInterval = null;
    this.cleanupInterval = null;
  }

  /**
   * Start the manager with periodic tasks
   */
  start() {
    console.log('🚀 Starting Socket Manager');

    // Check for idle agents every minute
    this.idleCheckInterval = setInterval(async () => {
      try {
        await checkIdleAgents(this.io);
      } catch (error) {
        console.error('❌ Error checking idle agents:', error);
      }
    }, 60 * 1000); // 1 minute

    // Cleanup rate limits every 5 minutes
    this.cleanupInterval = setInterval(() => {
      try {
        cleanupRateLimits();
      } catch (error) {
        console.error('❌ Error cleaning up rate limits:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Log connection stats every 5 minutes
    this.statsInterval = setInterval(() => {
      const stats = this.getConnectionStats();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Stop the manager
   */
  stop() {
    console.log('🛑 Stopping Socket Manager');
    
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  /**
   * Get connection statistics
   */
  getConnectionStats() {
    const sockets = this.io.sockets.sockets;
    const stats = {
      total: sockets.size,
      agents: 0,
      clients: 0,
      web: 0,
      mobile: 0,
      authenticated: 0
    };
    
    sockets.forEach(socket => {
      if (socket.isAuthenticated) stats.authenticated++;
      if (socket.user?.userType === 'agent') stats.agents++;
      if (socket.user?.userType === 'client') stats.clients++;
      if (socket.clientType === 'web') stats.web++;
      if (socket.clientType === 'mobile') stats.mobile++;
    });
    
    return stats;
  }

  /**
   * Get detailed socket information
   */
  getSocketDetails() {
    const sockets = this.io.sockets.sockets;
    const details = [];
    
    sockets.forEach(socket => {
      details.push({
        id: socket.id,
        userId: socket.user?.userId,
        userType: socket.user?.userType,
        clientType: socket.clientType,
        authenticated: socket.isAuthenticated,
        currentRoom: socket.currentChatGroup,
        connectedAt: socket.authenticatedAt
      });
    });
    
    return details;
  }

  /**
   * Force disconnect a socket
   */
  disconnectSocket(socketId, reason = 'Admin disconnect') {
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.disconnect(true);
      console.log(`🔌 Forcefully disconnected socket ${socketId}: ${reason}`);
      return true;
    }
    return false;
  }

  /**
   * Broadcast message to all connected sockets
   */
  broadcastToAll(event, data) {
    this.io.emit(event, data);
    console.log(`📡 Broadcasted ${event} to all ${this.io.sockets.sockets.size} sockets`);
  }

  /**
   * Broadcast message to specific user type
   */
  broadcastToUserType(userType, event, data) {
    let count = 0;
    this.io.sockets.sockets.forEach(socket => {
      if (socket.user?.userType === userType) {
        socket.emit(event, data);
        count++;
      }
    });
    console.log(`📡 Broadcasted ${event} to ${count} ${userType}s`);
  }
}

module.exports = SocketManager;