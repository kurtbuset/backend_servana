const EVENTS = require('../constants/events');

/**
 * Broadcast Emitters
 * Centralized functions for broadcasting events to rooms
 * Handles room-based emissions and notifications
 */
class BroadcastEmitter {
  // ============================================
  // MESSAGE BROADCASTS
  // ============================================

  /**
   * Broadcast message to room
   * @param {Server} io - Socket.IO server instance
   * @param {string} roomId - Room ID to broadcast to
   * @param {Object} message - Message data
   */
  static broadcastMessage(io, roomId, message) {
    io.to(String(roomId)).emit(EVENTS.RECEIVE_MESSAGE, message);
    console.log(`📤 Broadcast message to room ${roomId}:`, message.chat_id);
  }

  // ============================================
  // USER PRESENCE BROADCASTS
  // ============================================

  /**
   * Broadcast user joined to room
   * @param {Socket} socket - Socket instance
   * @param {string} roomId - Room ID
   * @param {string} userType - User type (agent/client)
   * @param {number} userId - User ID
   */
  static broadcastUserJoined(socket, roomId, userType, userId) {
    socket.to(String(roomId)).emit(EVENTS.USER_JOINED, {
      userType,
      userId,
      chatGroupId: roomId
    });
    console.log(`👋 Broadcast user joined to room ${roomId}: ${userType} ${userId}`);
  }

  /**
   * Broadcast user left to room
   * @param {Socket} socket - Socket instance
   * @param {string} roomId - Room ID
   * @param {string} userType - User type (agent/client)
   * @param {number} userId - User ID
   */
  static broadcastUserLeft(socket, roomId, userType, userId) {
    socket.to(String(roomId)).emit(EVENTS.USER_LEFT, {
      userType,
      userId,
      chatGroupId: roomId
    });
    console.log(`👋 Broadcast user left room ${roomId}: ${userType} ${userId}`);
  }

  // ============================================
  // TYPING BROADCASTS
  // ============================================

  /**
   * Broadcast typing indicator to room
   * @param {Socket} socket - Socket instance
   * @param {string} roomId - Room ID
   * @param {Object} data - Typing data
   */
  static broadcastTyping(socket, roomId, data) {
    socket.to(String(roomId)).emit(EVENTS.TYPING, data);
  }

  /**
   * Broadcast stop typing to room
   * @param {Socket} socket - Socket instance
   * @param {string} roomId - Room ID
   * @param {Object} data - Stop typing data
   */
  static broadcastStopTyping(socket, roomId, data) {
    socket.to(String(roomId)).emit(EVENTS.STOP_TYPING, data);
  }

  // ============================================
  // AGENT STATUS BROADCASTS
  // ============================================

  /**
   * Broadcast agent status change to department rooms
   * @param {Server} io - Socket.IO server instance
   * @param {Array<number>} departmentIds - Department IDs to broadcast to
   * @param {Object} statusData - Status change data
   */
  static broadcastAgentStatusChanged(io, departmentIds, statusData) {
    departmentIds.forEach(deptId => {
      const roomName = `department_${deptId}`;
      io.to(roomName).emit(EVENTS.AGENT_STATUS_CHANGED, statusData);
    });
    console.log(`📡 Broadcast agent status to ${departmentIds.length} departments:`, statusData.userId);
  }

  // ============================================
  // CUSTOMER LIST BROADCASTS
  // ============================================

  /**
   * Broadcast customer list update to department
   * @param {Server} io - Socket.IO server instance
   * @param {number} departmentId - Department ID
   * @param {Object} updateData - Customer list update data
   */
  static broadcastCustomerListUpdate(io, departmentId, updateData) {
    const roomName = `department_${departmentId}`;
    io.to(roomName).emit(EVENTS.CUSTOMER_LIST_UPDATE, updateData);
    console.log(`📋 Broadcast customer list update to department ${departmentId}`);
  }
}

module.exports = BroadcastEmitter;
