const supabase = require('../helpers/supabaseClient');

/**
 * User Status Manager - Handles cleanup and maintenance of online users
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
    console.log('✅ User Status Manager started');
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
    
    console.log('🛑 User Status Manager stopped');
  }

  /**
   * Start cleanup job: Check for stale users every 10 seconds
   */
  startCleanupJob() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleUsers();
    }, 10000); // Run every 10 seconds (reduced from 60s for faster cleanup)
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
   * Start rate limit cleanup job: Clean up expired rate limit data every 5 minutes
   */
  startRateLimitCleanup() {
    this.rateLimitCleanupInterval = setInterval(() => {
      this.userStatusHandlers.cleanupRateLimits();
      console.log('🧹 Rate limit data cleaned up');
    }, 300000); // Run every 5 minutes
  }

  /**
   * Clean up stale users who haven't sent heartbeat
   */
  async cleanupStaleUsers() {
    const now = new Date();
    const staleThreshold = 45000; // 45 seconds (reduced from 60s for faster cleanup)
    const onlineUsers = this.userStatusHandlers.getOnlineUsers();
    
    const staleUsers = [];
    
    onlineUsers.forEach((userData, userId) => {
      const timeSinceLastSeen = now - userData.lastSeen;
      
      if (timeSinceLastSeen > staleThreshold) {
        staleUsers.push({ userId, userData, timeSinceLastSeen });
      }
    });

    // Process stale users
    for (const { userId, userData, timeSinceLastSeen } of staleUsers) {
      console.log(`🧹 Cleaning up stale user ${userId} (last seen ${Math.floor(timeSinceLastSeen / 1000)}s ago)`);
      
      // Remove from online users
      onlineUsers.delete(userId);
      
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
          .update({ last_seen: userData.lastSeen.toISOString() })
          .eq('sys_user_id', userId);
        console.log(`💾 Updated stale user ${userId} in database`);
      } catch (err) {
        console.error('❌ Error updating stale user:', err);
      }
    }

    if (staleUsers.length > 0) {
      console.log(`🧹 Cleaned up ${staleUsers.length} stale users. Online users: ${onlineUsers.size}`);
    }
  }

  /**
   * Log room statistics for monitoring
   */
  logRoomStatistics() {
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

    if (activeRooms.length > 0) {
      const onlineUsersCount = this.userStatusHandlers.getOnlineUsersCount();
      console.log(`📊 Active Rooms: ${activeRooms.length}, Total Users: ${this.io.sockets.sockets.size}, Online Users: ${onlineUsersCount}`);
      console.log('Room Details:', activeRooms);
    }
  }

  /**
   * Get comprehensive status statistics
   */
  getStatusStatistics() {
    const onlineUsers = this.userStatusHandlers.getOnlineUsers();
    const rooms = this.io.sockets.adapter.rooms;
    
    const stats = {
      onlineUsers: onlineUsers.size,
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
    onlineUsers.forEach((userData) => {
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
    const onlineUsers = this.userStatusHandlers.getOnlineUsers();
    
    if (onlineUsers.has(userId)) {
      const userData = onlineUsers.get(userId);
      onlineUsers.delete(userId);
      
      const lastSeen = new Date();
      
      console.log(`🔧 Force offline user ${userId}: ${reason}`);
      
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
        console.log(`💾 Updated force-offline user ${userId} in database`);
      } catch (err) {
        console.error('❌ Error updating force-offline user:', err);
      }
      
      return true;
    }
    
    return false;
  }
}

module.exports = UserStatusManager;