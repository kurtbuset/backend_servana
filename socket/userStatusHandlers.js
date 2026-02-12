const supabase = require('../helpers/supabaseClient');

/**
 * Socket event handlers for user online/offline status management
 * Redis caching removed - using in-memory storage only
 */
class UserStatusHandlers {
  constructor(io) {
    this.io = io;
    this.MAX_UPDATES_PER_MINUTE = 10; // Max 10 status updates per minute per user
    
    // In-memory storage for user status (replaces Redis)
    this.onlineUsers = new Map(); // userId -> userData
    this.rateLimiters = new Map(); // userId -> { count, resetTime }
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
   * Security: Check rate limit for user using in-memory storage
   */
  async checkRateLimit(userId) {
    try {
      const now = Date.now();
      const rateLimitData = this.rateLimiters.get(userId);
      
      if (!rateLimitData) {
        // First request for this user
        this.rateLimiters.set(userId, {
          count: 1,
          resetTime: now + 60000 // Reset after 1 minute
        });
        return { allowed: true };
      }
      
      // Check if reset time has passed
      if (now > rateLimitData.resetTime) {
        // Reset the counter
        this.rateLimiters.set(userId, {
          count: 1,
          resetTime: now + 60000
        });
        return { allowed: true };
      }
      
      // Check if under limit
      if (rateLimitData.count < this.MAX_UPDATES_PER_MINUTE) {
        rateLimitData.count++;
        return { allowed: true };
      }
      
      return { 
        allowed: false, 
        error: 'Rate limit exceeded. Too many status updates.',
        retryAfter: Math.ceil((rateLimitData.resetTime - now) / 1000)
      };
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
    
    // All security checks passed - set user online in memory
    this.onlineUsers.set(userId, {
      socketId: socket.id,
      lastSeen: new Date(),
      userType,
      userName,
      status: 'online'
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
      // Update user status in memory
      const currentStatus = this.onlineUsers.get(userId);
      if (currentStatus) {
        const lastSeen = new Date();
        this.onlineUsers.set(userId, {
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
      this.onlineUsers.delete(userId);
      
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
      const onlineUsersList = Array.from(this.onlineUsers.entries()).map(([userId, data]) => ({
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
        const userData = this.onlineUsers.get(userId);
        
        // Only remove if this socket ID matches
        if (userData && userData.socketId === socket.id) {
          this.onlineUsers.delete(userId);
          
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
      const onlineUsersObj = {};
      for (const [userId, userData] of this.onlineUsers.entries()) {
        onlineUsersObj[userId] = userData;
      }
      return onlineUsersObj;
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
      return this.onlineUsers.size;
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
      return this.onlineUsers.has(userId);
    } catch (error) {
      console.error('❌ Error checking user online status:', error.message);
      return false;
    }
  }

  /**
   * Clean up rate limit data and stale users
   */
  async cleanupRateLimits() {
    const now = Date.now();
    
    // Clean up expired rate limiters
    for (const [userId, rateLimitData] of this.rateLimiters.entries()) {
      if (now > rateLimitData.resetTime) {
        this.rateLimiters.delete(userId);
      }
    }
    
    // Clean up stale online users (older than 5 minutes)
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    for (const [userId, userData] of this.onlineUsers.entries()) {
      const timeSinceLastSeen = now - new Date(userData.lastSeen).getTime();
      if (timeSinceLastSeen > staleThreshold) {
        this.onlineUsers.delete(userId);
        console.log(`🧹 Removed stale user ${userId} from online users`);
      }
    }
    
    console.log('🧹 Rate limits and stale users cleaned up');
  }
}

module.exports = UserStatusHandlers;