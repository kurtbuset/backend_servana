/**
 * Socket notifications index
 * Exports all notification modules for easier imports
 */

const AgentNotifier = require('./agentNotifier');
const ChatGroupNotifier = require('./chatGroupNotifier');

module.exports = {
  AgentNotifier,
  ChatGroupNotifier
};
