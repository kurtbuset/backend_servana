const supabase = require('../helpers/supabaseClient');

/**
 * Socket event handlers for user online/offline status management
 */
class UserStatusHandlers {
  constructor(io) {
    this.io = io;
    this.onlineUsers = new Map(); // { userId: { socketId, lastSeen, userType, userName } }
  }

  /**
   * Handle user coming online
   */
  async handleUserOnline(socket, data) {
    const { userId, userType, userName } = data;
    
    console.log('🟢 userOnline event received:', { userId, userType, userName, socketId: socket.id });
    
    // Store user as online
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
    
    // Update last_seen in database
    try {
      await supabase
        .from('sys_user')
        .update({ last_seen: new Date().toISOString() })
        .eq('sys_user_id', userId);
      console.log('💾 Updated last_seen in database for user:', userId);
    } catch (error) {
      console.error('❌ Error updating last_seen:', error);
    }
  }

  /**
   * Handle heartbeat to keep user online
   */
  async handleUserHeartbeat(socket, data) {
    const { userId } = data;
    
    if (this.onlineUsers.has(userId)) {
      // Update last seen timestamp
      const userData = this.onlineUsers.get(userId);
      const lastSeen = new Date();
      userData.lastSeen = lastSeen;
      this.onlineUsers.set(userId, userData);
      
      console.log(`💓 Heartbeat from user ${userId}`);
      
      // Broadcast status update to all clients (so they see user is online immediately)
      this.io.emit('userStatusChanged', {
        userId,
        status: 'online',
        lastSeen
      });
      
      // Update database
      try {
        await supabase
          .from('sys_user')
          .update({ last_seen: lastSeen.toISOString() })
          .eq('sys_user_id', userId);
      } catch (error) {
        console.error('❌ Error updating heartbeat:', error);
      }
    }
  }

  /**
   * Handle user going offline
   */
  async handleUserOffline(socket, data) {
    const { userId } = data;
    
    if (this.onlineUsers.has(userId)) {
      this.onlineUsers.delete(userId);
      
      const lastSeen = new Date();
      
      console.log(`❌ User ${userId} went offline`);
      
      // Broadcast to all clients that this user is offline
      this.io.emit('userStatusChanged', {
        userId,
        status: 'offline',
        lastSeen
      });
      
      // Update last_seen in database
      try {
        await supabase
          .from('sys_user')
          .update({ last_seen: lastSeen.toISOString() })
          .eq('sys_user_id', userId);
      } catch (error) {
        console.error('Error updating last_seen:', error);
      }
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
            await supabase
              .from('sys_user')
              .update({ last_seen: lastSeen.toISOString() })
              .eq('sys_user_id', userId);
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
}

module.exports = UserStatusHandlers;