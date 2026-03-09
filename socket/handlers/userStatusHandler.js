const supabase = require('../../helpers/supabaseClient');

/**
 * User Status Handler
 * Handles user online/offline status and heartbeat
 */
class UserStatusHandler {
  constructor(io) {
    this.io = io;
    this.onlineUsers = new Map(); // In-memory storage for online users
    this.rateLimits = new Map(); // Rate limiting for heartbeats
  }

  /**
   * Handle user coming online
   */
  async handleUserOnline(socket, data) {
    try {
      if (!socket.isAuthenticated || !socket.user) {
        socket.emit('statusError', { error: 'Authentication required' });
        return;
      }

      const userId = socket.user.userId;
      const userType = socket.user.userType;
      const now = new Date();

      // Store user status in memory
      this.onlineUsers.set(userId, {
        userId,
        userType,
        socketId: socket.id,
        lastSeen: now,
        status: 'online'
      });

      // Update database
      await supabase
        .from('sys_user')
        .update({ last_seen: now.toISOString() })
        .eq('sys_user_id', userId);

      // Broadcast status change
      this.io.emit('userStatusChanged', {
        userId,
        status: 'online',
        userType,
        lastSeen: now
      });

      console.log(`✅ User ${userId} (${userType}) is now online`);
    } catch (error) {
      console.error('❌ Error handling user online:', error);
      socket.emit('statusError', { error: 'Failed to set online status' });
    }
  }

  /**
   * Handle user heartbeat
   */
  async handleUserHeartbeat(socket, data) {
    try {
      if (!socket.isAuthenticated || !socket.user) {
        return;
      }

      const userId = socket.user.userId;
      const now = new Date();

      // Rate limiting: Only process heartbeat every 5 seconds
      const lastHeartbeat = this.rateLimits.get(userId);
      if (lastHeartbeat && (now - lastHeartbeat) < 5000) {
        return; // Skip this heartbeat
      }

      this.rateLimits.set(userId, now);

      // Update in-memory status
      const userData = this.onlineUsers.get(userId);
      if (userData) {
        userData.lastSeen = now;
        this.onlineUsers.set(userId, userData);
      }

      // Acknowledge heartbeat
      socket.emit('heartbeatAck', { timestamp: now });
    } catch (error) {
      console.error('❌ Error handling heartbeat:', error);
    }
  }

  /**
   * Handle user going offline
   */
  async handleUserOffline(socket, data) {
    try {
      if (!socket.user) {
        return;
      }

      const userId = socket.user.userId;
      await this.setUserOffline(userId);
    } catch (error) {
      console.error('❌ Error handling user offline:', error);
    }
  }

  /**
   * Handle user disconnect
   */
  async handleUserDisconnect(socket) {
    try {
      if (!socket.user) {
        return;
      }

      const userId = socket.user.userId;
      await this.setUserOffline(userId);
    } catch (error) {
      console.error('❌ Error handling disconnect:', error);
    }
  }

  /**
   * Set user offline
   */
  async setUserOffline(userId) {
    const now = new Date();
    
    // Remove from in-memory storage
    this.onlineUsers.delete(userId);
    this.rateLimits.delete(userId);

    // Update database
    try {
      await supabase
        .from('sys_user')
        .update({ last_seen: now.toISOString() })
        .eq('sys_user_id', userId);
    } catch (err) {
      console.error('❌ Error updating user offline status:', err);
    }

    // Broadcast status change
    this.io.emit('userStatusChanged', {
      userId,
      status: 'offline',
      lastSeen: now
    });

    console.log(`👋 User ${userId} is now offline`);
  }

  /**
   * Handle get online users request
   */
  handleGetOnlineUsers(socket) {
    const onlineUsers = {};
    
    this.onlineUsers.forEach((userData, userId) => {
      onlineUsers[userId] = {
        userId: userData.userId,
        userType: userData.userType,
        status: userData.status,
        lastSeen: userData.lastSeen
      };
    });

    socket.emit('onlineUsersList', onlineUsers);
  }

  /**
   * Get all online users
   */
  async getOnlineUsers() {
    const users = {};
    
    this.onlineUsers.forEach((userData, userId) => {
      users[userId] = userData;
    });

    return users;
  }

  /**
   * Cleanup rate limits
   */
  async cleanupRateLimits() {
    const now = new Date();
    const staleThreshold = 300000; // 5 minutes

    for (const [userId, lastHeartbeat] of this.rateLimits.entries()) {
      if (now - lastHeartbeat > staleThreshold) {
        this.rateLimits.delete(userId);
      }
    }
  }
}

module.exports = UserStatusHandler;
