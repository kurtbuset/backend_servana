/**
 * Centralized user presence constants for agent and chat group statuses.
 * Use these instead of hardcoded strings throughout the codebase.
 */

const CHAT_STATUS = {
  ACTIVE: 'active',
  QUEUED: 'queued',
  RESOLVED: 'resolved',
  PENDING: 'pending',
};

const USER_PRESENCE_STATUS = {
  ACCEPTING_CHATS: 'accepting_chats',
  NOT_ACCEPTING_CHATS: 'not_accepting_chats',
  OFFLINE: 'offline',
};

module.exports = { CHAT_STATUS, USER_PRESENCE_STATUS };
