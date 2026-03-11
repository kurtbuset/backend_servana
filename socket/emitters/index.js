/**
 * Socket Emitters Index
 * Exports all emitter modules for easier imports
 */

const ResponseEmitter = require('./response.emitters');
const BroadcastEmitter = require('./broadcast.emitters');

module.exports = {
  ResponseEmitter,
  BroadcastEmitter
};
