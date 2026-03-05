const RoomAccess = require('../authorization/roomAccess');

/**
 * Chat Room Handler
 * Handles joining and leaving chat rooms
 */
class ChatRoomHandler {
  constructor(io) {
    this.io = io;
    this.roomAccess = new RoomAccess();
  }

  /**
   * Handle user joining a chat group
   */
  async handleJoinChatGroup(socket, data) {
    try {
      const { groupId } = data;
      
      // Validate that socket is authenticated
      if (!socket.isAuthenticated || !socket.user) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      // Check room access authorization
      const roomAccess = await this.roomAccess.canJoinRoom(socket.user, groupId);
      if (!roomAccess.allowed) {
        socket.emit('error', { 
          message: 'Access denied', 
          reason: roomAccess.reason 
        });
        return;
      }

      // Leave previous room if agent was in another room
      if (socket.chatGroupId && socket.chatGroupId !== groupId) {
        socket.leave(String(socket.chatGroupId));
        
        // Notify previous room that agent left
        socket.to(String(socket.chatGroupId)).emit('userLeft', {
          userType: socket.user.userType,
          userId: socket.user.userId,
          chatGroupId: socket.chatGroupId
        });
      }
      
      // Join new room
      socket.join(String(groupId));
      socket.chatGroupId = groupId;
      
      // Notify new room that user joined
      socket.to(String(groupId)).emit('userJoined', {
        userType: socket.user.userType,
        userId: socket.user.userId,
        chatGroupId: groupId
      });

      // Send success confirmation
      socket.emit('joinedRoom', {
        chatGroupId: groupId,
        roomInfo: roomAccess.roomInfo
      });
    } catch (error) {
      console.error('❌ Error in handleJoinChatGroup:', error.message);
      socket.emit('error', { 
        message: 'Failed to join chat group',
        details: error.message 
      });
    }
  }

  /**
   * Handle explicit room leaving
   */
  handleLeavePreviousRoom(socket) {
    if (!socket.isAuthenticated || !socket.user) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    if (socket.chatGroupId) {
      socket.leave(String(socket.chatGroupId));
      
      // Notify room that user left
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: socket.user.userType,
        userId: socket.user.userId,
        chatGroupId: socket.chatGroupId
      });
      
      // Clear room info from socket
      socket.chatGroupId = null;
    }
  }

  /**
   * Handle specific room leaving
   */
  handleLeaveRoom(socket, data) {
    // Handle both old format (just roomId) and new format (object with roomId, userType, userId)
    let roomId, userType, userId;
    
    if (typeof data === 'object' && data.roomId) {
      // New format: { roomId, userType, userId }
      roomId = data.roomId;
      userType = data.userType || socket.userType || 'unknown';
      userId = data.userId || socket.userId || 'unknown';
    } else {
      // Old format: just roomId string/number
      roomId = data;
      userType = socket.userType || 'unknown';
      userId = socket.userId || 'unknown';
    }
    
    socket.leave(String(roomId));
    
    // Notify room that user left with proper user info
    socket.to(String(roomId)).emit('userLeft', {
      userType: userType,
      userId: userId,
      chatGroupId: roomId
    });
  }

  /**
   * Handle user disconnection
   */
  handleDisconnect(socket) {
    // Notify room members about user leaving
    if (socket.chatGroupId && socket.userType) {
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: socket.userType,
        userId: socket.userId,
        chatGroupId: socket.chatGroupId
      });
    }
  }
}

module.exports = ChatRoomHandler;
