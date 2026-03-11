/**
 * Socket notifications index
 * Exports all notification modules for easier imports
 */

const AgentNotifier = require('./agent.notifier');
const ChatGroupNotifier = require('./chat-group.notifier');

module.exports = {
  AgentNotifier,
  ChatGroupNotifier
};
