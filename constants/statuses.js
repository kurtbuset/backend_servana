/**
 * Centralized status constants for agent and chat group statuses.
 * Use these instead of hardcoded strings throughout the codebase.
 */

const AGENT_STATUS = {
  ACCEPTING: 'accepting_chats',
  NOT_ACCEPTING: 'not_accepting_chats',
  OFFLINE: 'offline',
};

const AGENT_STATUS_VALUES = Object.values(AGENT_STATUS);

const CHAT_STATUS = {
  ACTIVE: 'active',
  QUEUED: 'queued',
  RESOLVED: 'resolved',
  PENDING: 'pending',
};

module.exports = { AGENT_STATUS, AGENT_STATUS_VALUES, CHAT_STATUS };
