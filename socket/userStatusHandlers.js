const supabase = require('../helpers/supabaseClient');

/**
 * Socket event handlers for user online/offline status management
 * WITH SECURITY MEASURES
 */
class UserStatusHandlers {
  constructor(io) {
    this.io = io;
    this.onlineUsers = new Map(); // { userId: { socketId, lastSeen, userType, userName } }
    
    // Security: Rate limiting per user
    this.rateLimits = new Map(); // { userId: { count, resetTime } }
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
   * Security: Check rate limit for user
   */
  checkRateLimit(userId) {
    const now = Date.now();
    const userLimit = this.rateLimits.get(userId);
    
    if (!userLimit) {
      // First request from this user
      this.rateLimits.set(userId, {
        count: 1,
        resetTime: now + 60000 // Reset after 1 minute
      });
      return { allowed: true };
    }
    
    // Check if reset time has passed
    if (now > userLimit.resetTime) {
      // Reset the counter
      this.rateLimits.set(userId, {
        count: 1,
        resetTime: now + 60000
      });
      return { allowed: true };
    }
    
    // Check if limit exceeded
    if (userLimit.count >= this.MAX_UPDATES_PER_MINUTE) {
      return { 
        allowed: false, 
        error: 'Rate limit exceeded. Too many status updates.',
        retryAfter: Math.ceil((userLimit.resetTime - now) / 1000)
      };
    }
    
    // Increment counter
    userLimit.count++;
    this.rateLimits.set(userId, userLimit);
    
    return { allowed: true };
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
    
    console.log('🟢 userOnline event received:', { userId, userType, userName, socketId: socket.id });
    
    // Security: Validate input data
    const validation = this.validateUserData(data);
    if (!validation.valid) {
      console.error('❌ Invalid user data:', validation.error);
      socket.emit('error', { message: validation.error });
      return;
    }
    
    // Security: Check rate limit
    const rateLimit = this.checkRateLimit(userId);
    if (!rateLimit.allowed) {
      console.warn(`⚠️ Rate limit exceeded for user ${userId}`);
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
    
    // All security checks passed - proceed with status update
    this.onlineUsers.set(userId, {
      socketId: socket.id,
      lastSeen: new Date(),
      userType,
      userName
    });
    
    socket.userId = userId;
    socket.userType = userType;
    
    console.log(`✅ User ${userId} (${userName}) is now online. Total online: ${this.onlineUsers.size}`);
    
    // Broadcast to all clients that this user is online
    this.io.emit('userStatusChanged', {
      userId,
      status: 'online',
      lastSeen: new Date()
    });
    
    console.log('📡 Broadcasted userStatusChanged to all clients');
    
    // Update last_seen in database (with error handling)
    try {
      const { error } = await supabase
        .from('sys_user')
        .update({ last_seen: new Date().toISOString() })
        .eq('sys_user_id', userId);
      
      if (error) throw error;
      
      console.log('💾 Updated last_seen in database for user:', userId);
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
    const rateLimit = this.checkRateLimit(userId);
    if (!rateLimit.allowed) {
      console.warn(`⚠️ Heartbeat rate limit exceeded for user ${userId}`);
      return; // Silently ignore excessive heartbeats
    }
    
    if (this.onlineUsers.has(userId)) {
      // Update last seen timestamp
      const userData = this.onlineUsers.get(userId);
      const lastSeen = new Date();
      userData.lastSeen = lastSeen;
      this.onlineUsers.set(userId, userData);
      
      console.log(`💓 Heartbeat from user ${userId}`);
      
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
    
    if (this.onlineUsers.has(userId)) {
      this.onlineUsers.delete(userId);
      
      const lastSeen = new Date();
      
      console.log(`❌ User ${userId} went offline (explicit logout)`);
      
      // Broadcast to all clients that this user is offline
      this.io.emit('userStatusChanged', {
        userId,
        status: 'offline',
        lastSeen
      });
      
      console.log(`📡 Broadcasted offline status for user ${userId}`);
      
      // Update last_seen in database
      try {
        const { error } = await supabase
          .from('sys_user')
          .update({ last_seen: lastSeen.toISOString() })
          .eq('sys_user_id', userId);
        
        if (error) throw error;
        
        console.log(`💾 Updated database last_seen for user ${userId}`);
      } catch (error) {
        console.error('Error updating last_seen:', error);
      }
    } else {
      console.log(`⚠️ User ${userId} not found in onlineUsers Map (already offline or never online)`);
    }
  }

  /**
   * Handle get online users request
   */
  handleGetOnlineUsers(socket) {
    const onlineUsersList = Array.from(this.onlineUsers.entries()).map(([userId, data]) => ({
      userId,
      status: 'online',
      lastSeen: data.lastSeen,
      userType: data.userType,
      userName: data.userName
    }));
    
    console.log(`📋 getOnlineUsers request from ${socket.id}. Sending ${onlineUsersList.length} users`);
    
    socket.emit('onlineUsersList', onlineUsersList);
  }

  /**
   * Handle user disconnection cleanup
   */
  async handleUserDisconnect(socket) {
    if (socket.userId) {
      const userId = socket.userId;
      
      if (this.onlineUsers.has(userId)) {
        const userData = this.onlineUsers.get(userId);
        
        // Only remove if this socket ID matches
        if (userData.socketId === socket.id) {
          this.onlineUsers.delete(userId);
          
          const lastSeen = new Date();
          
          console.log(`❌ User ${userId} disconnected and removed from online users`);
          
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
      } else {
        console.log(`⚠️ User ${userId} not found in onlineUsers Map`);
      }
    } else {
      console.log(`⚠️ Socket ${socket.id} disconnected without userId`);
    }
  }

  /**
   * Get the online users map (for external access)
   */
  getOnlineUsers() {
    return this.onlineUsers;
  }

  /**
   * Get online users count
   */
  getOnlineUsersCount() {
    return this.onlineUsers.size;
  }

  /**
   * Clean up rate limit data periodically
   */
  cleanupRateLimits() {
    const now = Date.now();
    for (const [userId, limit] of this.rateLimits.entries()) {
      if (now > limit.resetTime + 60000) { // Keep for 1 extra minute
        this.rateLimits.delete(userId);
      }
    }
  }
}

module.exports = UserStatusHandlers;