const supabase = require('../helpers/supabaseClient');
const cacheService = require('../services/cache.service');

/**
 * Socket event handlers for user online/offline status management
 * Now uses centralized Redis cache manager
 */
class UserStatusHandlers {
  constructor(io) {
    this.io = io;
    this.MAX_UPDATES_PER_MINUTE = 10; // Max 10 status updates per minute per user
  }

  /**
   * Security: Validate user data
   */
  validateUserData(data) {
    const { userId, userType, userName } = data;
    
    // Check required fields
    if (!userId || typeof userId !== 'number') {
      return { valid: false, error: 'Invalid or missing userId' };
    }
    
    if (!userType || typeof userType !== 'string') {
      return { valid: false, error: 'Invalid or missing userType' };
    }
    
    if (!userName || typeof userName !== 'string') {
      return { valid: false, error: 'Invalid or missing userName' };
    }
    
    // Sanitize strings to prevent injection
    if (userName.length > 100) {
      return { valid: false, error: 'userName too long (max 100 characters)' };
    }
    
    if (userType.length > 50) {
      return { valid: false, error: 'userType too long (max 50 characters)' };
    }
    
    return { valid: true };
  }

  /**
   * Security: Check rate limit for user using Redis
   */
  async checkRateLimit(userId) {
    try {
      const rateLimitKey = `user_status_${userId}`;
      const allowed = await cacheService.checkRateLimit(rateLimitKey, this.MAX_UPDATES_PER_MINUTE, 60);
      
      if (!allowed) {
        return { 
          allowed: false, 
          error: 'Rate limit exceeded. Too many status updates.',
          retryAfter: 60
        };
      }
      
      return { allowed: true };
    } catch (error) {
      console.error('❌ Error checking rate limit:', error.message);
      return { allowed: true }; // Allow on error
    }
  }

  /**
   * Security: Verify user owns the socket
   */
  verifySocketOwnership(socket, userId) {
    // Check if socket already has a userId assigned
    if (socket.userId && socket.userId !== userId) {
      return { 
        valid: false, 
        error: 'Socket already assigned to different user. Possible hijacking attempt.' 
      };
    }
    
    return { valid: true };
  }

  /**
   * Security: Verify user exists in database
   */
  async verifyUserExists(userId) {
    try {
      const { data, error } = await supabase
        .from('sys_user')
        .select('sys_user_id, sys_user_is_active')
        .eq('sys_user_id', userId)
        .single();
      
      if (error || !data) {
        return { valid: false, error: 'User not found in database' };
      }
      
      if (!data.sys_user_is_active) {
        return { valid: false, error: 'User account is inactive' };
      }
      
      return { valid: true };
    } catch (error) {
      console.error('❌ Error verifying user:', error);
      return { valid: false, error: 'Database verification failed' };
    }
  }

  /**
   * Handle user coming online - WITH SECURITY
   */
  async handleUserOnline(socket, data) {
    const { userId, userType, userName } = data;
    
    // Security: Validate input data
    const validation = this.validateUserData(data);
    if (!validation.valid) {
      console.error('❌ Invalid user data:', validation.error);
      socket.emit('error', { message: validation.error });
      return;
    }
    
    // Security: Check rate limit
    const rateLimit = await this.checkRateLimit(userId);
    if (!rateLimit.allowed) {
      socket.emit('error', { 
        message: rateLimit.error,
        retryAfter: rateLimit.retryAfter
      });
      return;
    }
    
    // Security: Verify socket ownership
    const ownership = this.verifySocketOwnership(socket, userId);
    if (!ownership.valid) {
      console.error('❌ Socket ownership verification failed:', ownership.error);
      socket.emit('error', { message: ownership.error });
      return;
    }
    
    // Security: Verify user exists and is active
    const userExists = await this.verifyUserExists(userId);
    if (!userExists.valid) {
      console.error('❌ User verification failed:', userExists.error);
      socket.emit('error', { message: userExists.error });
      return;
    }
    
    // All security checks passed - set user online in cache
    await cacheService.setUserOnline(userId, {
      socketId: socket.id,
      lastSeen: new Date(),
      userType,
      userName
    });
    
    socket.userId = userId;
    socket.userType = userType;
    
    // Broadcast to all clients that this user is online
    this.io.emit('userStatusChanged', {
      userId,
      status: 'online',
      lastSeen: new Date()
    });
    
    // Update last_seen in database (with error handling)
    try {
      const { error } = await supabase
        .from('sys_user')
        .update({ last_seen: new Date().toISOString() })
        .eq('sys_user_id', userId);
      
      if (error) throw error;
    } catch (error) {
      console.error('❌ Error updating last_seen:', error);
      // Don't expose database errors to client
    }
  }

  /**
   * Handle heartbeat to keep user online - WITH SECURITY
   */
  async handleUserHeartbeat(socket, data) {
    const { userId } = data;
    
    // Security: Validate userId
    if (!userId || typeof userId !== 'number') {
      console.error('❌ Invalid userId in heartbeat');
      return;
    }
    
    // Security: Verify socket owns this userId
    if (socket.userId !== userId) {
      console.error(`❌ Heartbeat userId mismatch. Socket: ${socket.userId}, Data: ${userId}`);
      socket.emit('error', { message: 'Unauthorized heartbeat attempt' });
      return;
    }
    
    // Security: Check rate limit
    const rateLimit = await this.checkRateLimit(userId);
    if (!rateLimit.allowed) {
      return; // Silently ignore excessive heartbeats
    }
    
    const isOnline = await this.isUserOnline(userId);
    if (isOnline) {
      // Update user status in cache
      const currentStatus = await cacheService.getUserStatus(userId);
      if (currentStatus) {
        const lastSeen = new Date();
        await cacheService.setUserOnline(userId, {
          ...currentStatus,
          lastSeen,
          socketId: socket.id
        });
        
        // Broadcast status update to all clients
        this.io.emit('userStatusChanged', {
          userId,
          status: 'online',
          lastSeen
        });
        
        // Update database
        try {
          const { error } = await supabase
            .from('sys_user')
            .update({ last_seen: lastSeen.toISOString() })
            .eq('sys_user_id', userId);
          
          if (error) throw error;
        } catch (error) {
          console.error('❌ Error updating heartbeat:', error);
        }
      }
    }
  }

  /**
   * Handle user going offline - WITH SECURITY
   */
  async handleUserOffline(socket, data) {
    const { userId } = data;
    
    // Security: Validate userId
    if (!userId || typeof userId !== 'number') {
      console.error('❌ Invalid userId in offline event');
      return;
    }
    
    // Security: Verify socket owns this userId (allow if socket.userId not set yet for logout scenarios)
    if (socket.userId && socket.userId !== userId) {
      console.error(`❌ Offline userId mismatch. Socket: ${socket.userId}, Data: ${userId}`);
      socket.emit('error', { message: 'Unauthorized offline attempt' });
      return;
    }
    
    const isOnline = await this.isUserOnline(userId);
    if (isOnline) {
      await cacheService.setUserOffline(userId);
      
      const lastSeen = new Date();
      
      // Broadcast to all clients that this user is offline
      this.io.emit('userStatusChanged', {
        userId,
        status: 'offline',
        lastSeen
      });
      
      // Update last_seen in database
      try {
        const { error } = await supabase
          .from('sys_user')
          .update({ last_seen: lastSeen.toISOString() })
          .eq('sys_user_id', userId);
        
        if (error) throw error;
      } catch (error) {
        console.error('Error updating last_seen:', error);
      }
    }
  }

  /**
   * Handle get online users request
   */
  async handleGetOnlineUsers(socket) {
    try {
      const onlineUsers = await cacheService.getOnlineUsers();
      const onlineUsersList = Object.entries(onlineUsers).map(([userId, data]) => ({
        userId: parseInt(userId),
        status: 'online',
        lastSeen: data.lastSeen,
        userType: data.userType,
        userName: data.userName
      }));
      
      socket.emit('onlineUsersList', onlineUsersList);
    } catch (error) {
      console.error('❌ Error getting online users:', error.message);
      socket.emit('onlineUsersList', []);
    }
  }

  /**
   * Handle user disconnection cleanup
   */
  async handleUserDisconnect(socket) {
    if (socket.userId) {
      const userId = socket.userId;
      
      const isOnline = await this.isUserOnline(userId);
      if (isOnline) {
        const userData = await cacheService.getUserStatus(userId);
        
        // Only remove if this socket ID matches
        if (userData && userData.socketId === socket.id) {
          await cacheService.setUserOffline(userId);
          
          const lastSeen = new Date();
          
          // Broadcast to all clients that this user is offline
          this.io.emit('userStatusChanged', {
            userId,
            status: 'offline',
            lastSeen
          });
          
          // Update last_seen in database
          try {
            const { error } = await supabase
              .from('sys_user')
              .update({ last_seen: lastSeen.toISOString() })
              .eq('sys_user_id', userId);
            
            if (error) throw error;
          } catch (error) {
            console.error('❌ Error updating last_seen on disconnect:', error);
          }
        }
      }
    }
  }

  /**
   * Get the online users (for external access)
   */
  async getOnlineUsers() {
    try {
      return await cacheService.getOnlineUsers();
    } catch (error) {
      console.error('❌ Error getting online users:', error.message);
      return {};
    }
  }

  /**
   * Get online users count
   */
  async getOnlineUsersCount() {
    try {
      const onlineUsers = await cacheService.getOnlineUsers();
      return Object.keys(onlineUsers).length;
    } catch (error) {
      console.error('❌ Error getting online users count:', error.message);
      return 0;
    }
  }

  /**
   * Check if user is online
   */
  async isUserOnline(userId) {
    try {
      const onlineUsers = await cacheService.getOnlineUsers();
      return !!onlineUsers[userId];
    } catch (error) {
      console.error('❌ Error checking user online status:', error.message);
      return false;
    }
  }

  /**
   * Clean up rate limit data (now handled by Redis TTL)
   */
  async cleanupRateLimits() {
    // Rate limits are automatically cleaned up by Redis TTL
    console.log('🧹 Rate limits cleaned up automatically by Redis TTL');
  }
}

module.exports = UserStatusHandlers;