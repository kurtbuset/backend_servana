/**
 * Socket Events Index
 * Exports all event handlers
 */

const ChatEvents = require('./chatEvents');
const UserStatusEvents = require('./userStatusEvents');
const AgentStatusEvents = require('./agentStatusEvents');

module.exports = {
  ChatEvents,
  UserStatusEvents,
  AgentStatusEvents
};
