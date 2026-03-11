const RoomAccess = require('../authorization/room.access');
const EVENTS = require('../constants/events');
const { ResponseEmitter, BroadcastEmitter } = require('../emitters');

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
        ResponseEmitter.emitError(socket, 'Authentication required');
        return;
      }

      // Check room access authorization
      const roomAccess = await this.roomAccess.canJoinRoom(socket.user, groupId);
      if (!roomAccess.allowed) {
        ResponseEmitter.emitError(socket, 'Access denied', roomAccess.reason);
        return;
      }

      // Leave previous room if agent was in another room
      if (socket.chatGroupId && socket.chatGroupId !== groupId) {
        socket.leave(String(socket.chatGroupId));
        
        // Notify previous room that agent left
        BroadcastEmitter.broadcastUserLeft(socket, String(socket.chatGroupId), socket.user.userType, socket.user.userId, socket.chatGroupId);
      }
      
      // Join new room
      socket.join(String(groupId));
      socket.chatGroupId = groupId;
      
      // Notify new room that user joined
      BroadcastEmitter.broadcastUserJoined(socket, String(groupId), socket.user.userType, socket.user.userId, groupId);

      // Send success confirmation
      ResponseEmitter.emitJoinedRoom(socket, groupId, roomAccess.roomInfo);
    } catch (error) {
      console.error('❌ Error in handleJoinChatGroup:', error.message);
      ResponseEmitter.emitError(socket, 'Failed to join chat group', error.message);
    }
  }

  /**
   * Handle explicit room leaving
   */
  handleLeavePreviousRoom(socket) {
    if (!socket.isAuthenticated || !socket.user) {
      ResponseEmitter.emitError(socket, 'Authentication required');
      return;
    }

    if (socket.chatGroupId) {
      socket.leave(String(socket.chatGroupId));
      
      // Notify room that user left
      BroadcastEmitter.broadcastUserLeft(socket, String(socket.chatGroupId), socket.user.userType, socket.user.userId, socket.chatGroupId);
      
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
    BroadcastEmitter.broadcastUserLeft(socket, String(roomId), userType, userId, roomId);
  }

  /**
   * Handle user disconnection
   */
  handleDisconnect(socket) {
    // Notify room members about user leaving
    if (socket.chatGroupId && socket.userType) {
      BroadcastEmitter.broadcastUserLeft(socket, String(socket.chatGroupId), socket.userType, socket.userId, socket.chatGroupId);
    }
  }
}

module.exports = ChatRoomHandler;
