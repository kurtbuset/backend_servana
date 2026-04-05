/**
 * Socket Manager
 * Handles periodic tasks and cleanup for socket operations
 */

const { cacheManager } = require('../helpers/redisClient');
const { USER_PRESENCE_STATUS } = require('../constants/statuses');
const { setPresenceAndBroadcast } = require('./connection');

class SocketManager {
  constructor(io) {
    this.io = io;
    this.idleCheckInterval = null;
    this.cleanupInterval = null;
    this.presenceCleanupInterval = null;
  }

  /**
   * Start the manager with periodic tasks
   */
  start() {
    console.log('🚀 Starting Socket Manager');
    
    // Start presence cleanup task (runs every 5 minutes)
    this.startPresenceCleanup();
  }

  /**
   * Clean up stale presence entries
   * Marks users as offline if they haven't sent a heartbeat in 15+ minutes
   */
  startPresenceCleanup() {
    this.presenceCleanupInterval = setInterval(async () => {
      try {
        const allPresences = await cacheManager.getAllUserPresence();
        const now = new Date();
        const staleThreshold = 15 * 60 * 1000; // 15 minutes
        
        let cleanedCount = 0;
        
        for (const [userId, presence] of Object.entries(allPresences)) {
          const lastSeen = new Date(presence.lastSeen);
          const timeSinceLastSeen = now - lastSeen;
          
          // If user hasn't been seen in 15+ minutes and not already offline
          if (timeSinceLastSeen > staleThreshold && presence.userPresence !== USER_PRESENCE_STATUS.OFFLINE) {
            console.log(`🧹 Cleaning stale presence: userId=${userId} (last seen ${Math.floor(timeSinceLastSeen / 1000 / 60)} minutes ago)`);
            
            await setPresenceAndBroadcast(this.io, userId, {
              ...presence,
              userPresence: USER_PRESENCE_STATUS.OFFLINE,
              lastSeen: now.toISOString()
            }, { reason: 'stale_cleanup' });
            
            cleanedCount++;
          }
        }
        
        if (cleanedCount > 0) {
          console.log(`✅ Presence cleanup completed: ${cleanedCount} stale entries marked offline`);
        }
      } catch (error) {
        console.error('❌ Error in presence cleanup:', error);
      }
    }, 5 * 60 * 1000); // Run every 5 minutes
    
    console.log('✅ Presence cleanup task started (runs every 5 minutes)');
  }

  /**
   * Stop the manager
   */
  stop() {
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

    if (this.presenceCleanupInterval) {
      clearInterval(this.presenceCleanupInterval);
      this.presenceCleanupInterval = null;
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

  /**
   * Get all user presences from Redis
   */
  async getAllPresences() {
    try {
      return await cacheManager.getAllUserPresence();
    } catch (error) {
      console.error('❌ Error getting all presences:', error);
      return {};
    }
  }

  /**
   * Get presence for specific user
   */
  async getUserPresence(userId) {
    try {
      return await cacheManager.getUserPresence(userId);
    } catch (error) {
      console.error('❌ Error getting user presence:', error);
      return null;
    }
  }

  /**
   * Force update user presence (admin function)
   */
  async forceUpdatePresence(userId, status) {
    try {
      const presence = await cacheManager.getUserPresence(userId);
      
      if (!presence) {
        console.error(`❌ User ${userId} not found in presence cache`);
        return false;
      }

      await setPresenceAndBroadcast(this.io, userId, {
        ...presence,
        userPresence: status,
        lastSeen: new Date().toISOString()
      }, { reason: 'admin_update' });

      console.log(`✅ Force updated presence: userId=${userId} -> ${status}`);
      return true;
    } catch (error) {
      console.error('❌ Error force updating presence:', error);
      return false;
    }
  }
}

module.exports = SocketManager;