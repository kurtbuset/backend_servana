/**
 * Socket Event Constants
 * Centralized event names to prevent typos and enable refactoring
 * 
 * Convention:
 * - INCOMING: Events received by server (client → server)
 * - OUTGOING: Events emitted by server (server → client)
 */

// ============================================
// CHAT EVENTS
// ============================================

// Incoming (Client → Server)
const JOIN_CHAT_GROUP = 'joinChatGroup';
const LEAVE_PREVIOUS_ROOM = 'leavePreviousRoom';
const LEAVE_ROOM = 'leaveRoom';
const SEND_MESSAGE = 'sendMessage';

// Outgoing (Server → Client)
const RECEIVE_MESSAGE = 'receiveMessage';
const MESSAGE_DELIVERED = 'messageDelivered';
const MESSAGE_ERROR = 'messageError';
const CUSTOMER_LIST_UPDATE = 'customerListUpdate';
const USER_JOINED = 'userJoined';
const USER_LEFT = 'userLeft';
const JOINED_ROOM = 'joinedRoom';

// ============================================
// TYPING EVENTS
// ============================================

// Incoming (Client → Server)
const TYPING = 'typing';
const STOP_TYPING = 'stopTyping';

// Outgoing (Server → Client)
// (Same as incoming - broadcast to room)

// ============================================
// AGENT STATUS EVENTS
// ============================================

// Incoming (Client → Server)
const AGENT_ONLINE = 'agentOnline';
const AGENT_OFFLINE = 'agentOffline';
const AGENT_HEARTBEAT = 'agentHeartbeat';
const UPDATE_AGENT_STATUS = 'updateAgentStatus';
const GET_AGENT_STATUSES = 'getAgentStatuses';

// Outgoing (Server → Client)
const AGENT_STATUSES_LIST = 'agentStatusesList';
const AGENT_STATUS_CHANGED = 'agentStatusChanged';
const AGENT_STATUS_ERROR = 'agentStatusError';
const AGENT_STATUS_UPDATE_SUCCESS = 'agentStatusUpdateSuccess';
const AGENT_HEARTBEAT_ACK = 'agentHeartbeatAck';

// ============================================
// AUTHENTICATION EVENTS
// ============================================

// Outgoing (Server → Client)
const TOKEN_REFRESHED = 'token_refreshed';
const TOKEN_EXPIRING = 'token_expiring';
const SESSION_EXPIRED = 'session_expired';
const TOKEN_REFRESH_REQUIRED = 'token_refresh_required';
const NEW_TOKEN = 'new_token';

// ============================================
// CONNECTION EVENTS (Socket.IO Built-in)
// ============================================

const CONNECT = 'connect';
const DISCONNECT = 'disconnect';
const CONNECT_ERROR = 'connect_error';
const RECONNECT = 'reconnect';
const RECONNECT_ATTEMPT = 'reconnect_attempt';
const RECONNECT_FAILED = 'reconnect_failed';

// ============================================
// ERROR EVENTS
// ============================================

const ERROR = 'error';

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Chat
  JOIN_CHAT_GROUP,
  LEAVE_PREVIOUS_ROOM,
  LEAVE_ROOM,
  SEND_MESSAGE,
  RECEIVE_MESSAGE,
  MESSAGE_DELIVERED,
  MESSAGE_ERROR,
  CUSTOMER_LIST_UPDATE,
  USER_JOINED,
  USER_LEFT,
  JOINED_ROOM,
  
  // Typing
  TYPING,
  STOP_TYPING,
  
  // Agent Status
  AGENT_ONLINE,
  AGENT_OFFLINE,
  AGENT_HEARTBEAT,
  UPDATE_AGENT_STATUS,
  GET_AGENT_STATUSES,
  AGENT_STATUSES_LIST,
  AGENT_STATUS_CHANGED,
  AGENT_STATUS_ERROR,
  AGENT_STATUS_UPDATE_SUCCESS,
  AGENT_HEARTBEAT_ACK,
  
  // Authentication
  TOKEN_REFRESHED,
  TOKEN_EXPIRING,
  SESSION_EXPIRED,
  TOKEN_REFRESH_REQUIRED,
  NEW_TOKEN,
  
  // Connection
  CONNECT,
  DISCONNECT,
  CONNECT_ERROR,
  RECONNECT,
  RECONNECT_ATTEMPT,
  RECONNECT_FAILED,
  
  // Errors
  ERROR
};
