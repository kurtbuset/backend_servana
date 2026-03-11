const EVENTS = require('../constants/events');

/**
 * Response Emitters
 * Centralized functions for emitting response events to clients
 * Provides consistent patterns, logging, and error handling
 */
class ResponseEmitter {
  // ============================================
  // AGENT STATUS RESPONSES
  // ============================================

  /**
   * Emit agent status error
   * @param {Socket} socket - Socket instance
   * @param {string} error - Error message
   */
  static emitAgentStatusError(socket, error) {
    socket.emit(EVENTS.AGENT_STATUS_ERROR, { error });
    console.error(`❌ Agent status error [${socket.id}]:`, error);
  }

  /**
   * Emit agent statuses list
   * @param {Socket} socket - Socket instance
   * @param {Object} statuses - Agent statuses object
   */
  static emitAgentStatusesList(socket, statuses) {
    socket.emit(EVENTS.AGENT_STATUSES_LIST, statuses);
    console.log(`📋 Sent ${Object.keys(statuses).length} agent statuses to ${socket.id}`);
  }

  /**
   * Emit agent status update success
   * @param {Socket} socket - Socket instance
   * @param {string} agentStatus - New agent status
   * @param {Date} timestamp - Update timestamp
   */
  static emitAgentStatusUpdateSuccess(socket, agentStatus, timestamp) {
    socket.emit(EVENTS.AGENT_STATUS_UPDATE_SUCCESS, { agentStatus, timestamp });
    console.log(`✅ Agent status update success [${socket.id}]:`, agentStatus);
  }

  /**
   * Emit agent heartbeat acknowledgment
   * @param {Socket} socket - Socket instance
   * @param {Date} timestamp - Heartbeat timestamp
   */
  static emitAgentHeartbeatAck(socket, timestamp) {
    socket.emit(EVENTS.AGENT_HEARTBEAT_ACK, { timestamp });
  }

  // ============================================
  // MESSAGE RESPONSES
  // ============================================

  /**
   * Emit message error
   * @param {Socket} socket - Socket instance
   * @param {string} error - Error message
   * @param {Object} details - Additional error details
   */
  static emitMessageError(socket, error, details = {}) {
    socket.emit(EVENTS.MESSAGE_ERROR, { error, ...details });
    console.error(`❌ Message error [${socket.id}]:`, error);
  }

  /**
   * Emit message delivered confirmation
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Delivery confirmation data
   */
  static emitMessageDelivered(socket, data) {
    socket.emit(EVENTS.MESSAGE_DELIVERED, data);
    console.log(`✅ Message delivered [${socket.id}]:`, data.chat_id);
  }

  // ============================================
  // CHAT ROOM RESPONSES
  // ============================================

  /**
   * Emit joined room confirmation
   * @param {Socket} socket - Socket instance
   * @param {number} chatGroupId - Chat group ID
   * @param {Object} roomInfo - Room information
   */
  static emitJoinedRoom(socket, chatGroupId, roomInfo = {}) {
    socket.emit(EVENTS.JOINED_ROOM, { chatGroupId, roomInfo });
    console.log(`✅ User joined room [${socket.id}]:`, chatGroupId);
  }

  // ============================================
  // GENERAL RESPONSES
  // ============================================

  /**
   * Emit general error
   * @param {Socket} socket - Socket instance
   * @param {string} message - Error message
   * @param {Object} details - Additional error details
   */
  static emitError(socket, message, details = {}) {
    socket.emit(EVENTS.ERROR, { message, ...details });
    console.error(`❌ Error [${socket.id}]:`, message);
  }

  // ============================================
  // AUTHENTICATION RESPONSES
  // ============================================

  /**
   * Emit token refreshed notification
   * @param {Socket} socket - Socket instance
   * @param {string} message - Success message
   * @param {number} expiresAt - Token expiration timestamp
   */
  static emitTokenRefreshed(socket, message, expiresAt) {
    socket.emit(EVENTS.TOKEN_REFRESHED, { message, expires_at: expiresAt });
    console.log(`✅ Token refreshed [${socket.id}]`);
  }

  /**
   * Emit token expiring warning
   * @param {Socket} socket - Socket instance
   * @param {string} message - Warning message  
   * @param {number} gracePeriodSeconds - Grace period in seconds
   */
  static emitTokenExpiring(socket, message, gracePeriodSeconds) {
    socket.emit(EVENTS.TOKEN_EXPIRING, { message, grace_period_seconds: gracePeriodSeconds });
    console.warn(`⚠️ Token expiring [${socket.id}]`);
  }

  /**
   * Emit session expired notification
   * @param {Socket} socket - Socket instance
   * @param {string} reason - Expiration reason
   * @param {string} message - User-friendly message
   */
  static emitSessionExpired(socket, reason, message) {
    socket.emit(EVENTS.SESSION_EXPIRED, { reason, message });
    console.error(`❌ Session expired [${socket.id}]:`, reason);
  }

  /**
   * Emit token refresh required
   * @param {Socket} socket - Socket instance
   * @param {Object} tokenData - New token data
   */
  static emitTokenRefreshRequired(socket, tokenData) {
    socket.emit(EVENTS.TOKEN_REFRESH_REQUIRED, tokenData);
    console.log(`🔄 Token refresh required [${socket.id}]`);
  }

  /**
   * Emit new token (for mobile clients)
   * @param {Socket} socket - Socket instance
   * @param {string} accessToken - New access token
   * @param {number} expiresAt - Token expiration timestamp
   */
  static emitNewToken(socket, accessToken, expiresAt) {
    socket.emit(EVENTS.NEW_TOKEN, { access_token: accessToken, expires_at: expiresAt });
    console.log(`🔄 New token sent [${socket.id}]`);
  }
}

module.exports = ResponseEmitter;
