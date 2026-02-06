const supabase = require('../helpers/supabaseClient');
const cacheService = require('../services/cache.service');

/**
 * User Status Manager - Handles cleanup and maintenance of online users
 * Now uses centralized cache manager
 */
class UserStatusManager {
  constructor(io, userStatusHandlers) {
    this.io = io;
    this.userStatusHandlers = userStatusHandlers;
    this.cleanupInterval = null;
    this.roomStatsInterval = null;
    this.rateLimitCleanupInterval = null;
  }

  /**
   * Start the user status management system
   */
  start() {
    this.startCleanupJob();
    this.startRoomStatsLogging();
    this.startRateLimitCleanup();
  }

  /**
   * Stop the user status management system
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.roomStatsInterval) {
      clearInterval(this.roomStatsInterval);
      this.roomStatsInterval = null;
    }
    
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
      this.rateLimitCleanupInterval = null;
    }
  }

  /**
   * Start cleanup job: Check for stale users every 10 seconds
   */
  startCleanupJob() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleUsers();
    }, 10000); // Run every 10 seconds
  }

  /**
   * Start room statistics logging
   */
  startRoomStatsLogging() {
    this.roomStatsInterval = setInterval(() => {
      this.logRoomStatistics();
    }, 30000); // Log every 30 seconds
  }

  /**
   * Start rate limit cleanup job
   */
  startRateLimitCleanup() {
    this.rateLimitCleanupInterval = setInterval(async () => {
      await cacheService.cleanup();
      console.log('🧹 Cache cleanup completed');
    }, 300000); // Run every 5 minutes
  }

  /**
   * Clean up stale users who haven't sent heartbeat
   */
  async cleanupStaleUsers() {
    const now = new Date();
    const staleThreshold = 45000; // 45 seconds
    const onlineUsers = await cacheService.getOnlineUsers();
    
    const staleUsers = [];
    
    for (const [userId, userData] of Object.entries(onlineUsers)) {
      const lastSeen = new Date(userData.lastSeen);
      const timeSinceLastSeen = now - lastSeen;
      
      if (timeSinceLastSeen > staleThreshold) {
        staleUsers.push({ userId, userData, timeSinceLastSeen });
      }
    }

    // Process stale users
    for (const { userId, userData, timeSinceLastSeen } of staleUsers) {
      // Set user offline in cache
      await cacheService.setUserOffline(userId);
      
      // Broadcast offline status
      this.io.emit('userStatusChanged', {
        userId,
        status: 'offline',
        lastSeen: userData.lastSeen
      });
      
      // Update database
      try {
        await supabase
          .from('sys_user')
          .update({ last_seen: new Date(userData.lastSeen).toISOString() })
          .eq('sys_user_id', userId);
      } catch (err) {
        console.error('❌ Error updating stale user:', err);
      }
    }
  }

  /**
   * Log room statistics for monitoring
   */
  async logRoomStatistics() {
    const rooms = this.io.sockets.adapter.rooms;
    const activeRooms = [];
    
    rooms.forEach((sockets, roomName) => {
      // Skip default socket rooms (socket IDs)
      if (!sockets.has(roomName)) {
        activeRooms.push({
          room: roomName,
          users: sockets.size
        });
      }
    });

    // Only log if there are active rooms to avoid spam
    if (activeRooms.length > 5) {
      const onlineUsers = await cacheService.getOnlineUsers();
      const onlineUsersCount = Object.keys(onlineUsers).length;
      console.log(`📊 Active Rooms: ${activeRooms.length}, Total Users: ${this.io.sockets.sockets.size}, Online Users: ${onlineUsersCount}`);
    }
  }

  /**
   * Get comprehensive status statistics
   */
  async getStatusStatistics() {
    const onlineUsers = await cacheService.getOnlineUsers();
    const rooms = this.io.sockets.adapter.rooms;
    
    const stats = {
      onlineUsers: Object.keys(onlineUsers).length,
      totalConnections: this.io.sockets.sockets.size,
      activeRooms: 0,
      roomDetails: [],
      userTypes: {
        agent: 0,
        client: 0,
        unknown: 0
      }
    };

    // Count user types
    Object.values(onlineUsers).forEach((userData) => {
      const userType = userData.userType || 'unknown';
      stats.userTypes[userType] = (stats.userTypes[userType] || 0) + 1;
    });

    // Count active rooms
    rooms.forEach((sockets, roomName) => {
      if (!sockets.has(roomName)) {
        stats.activeRooms++;
        stats.roomDetails.push({
          room: roomName,
          users: sockets.size
        });
      }
    });

    return stats;
  }

  /**
   * Force cleanup of a specific user
   */
  async forceUserOffline(userId, reason = 'Manual cleanup') {
    const onlineUsers = await cacheService.getOnlineUsers();
    
    if (onlineUsers[userId]) {
      const lastSeen = new Date();
      
      // Set user offline in cache
      await cacheService.setUserOffline(userId);
      
      // Broadcast offline status
      this.io.emit('userStatusChanged', {
        userId,
        status: 'offline',
        lastSeen
      });
      
      // Update database
      try {
        await supabase
          .from('sys_user')
          .update({ last_seen: lastSeen.toISOString() })
          .eq('sys_user_id', userId);
      } catch (err) {
        console.error('❌ Error updating force-offline user:', err);
      }
      
      return true;
    }
    
    return false;
  }
}

module.exports = UserStatusManager;