/**
 * Shared structured logger for backend services.
 * Wraps console methods with a consistent format:
 *   [context] LEVEL timestamp  message  { data }
 *
 * Levels:
 *   info  — normal operations (connect, disconnect, status change, requests)
 *   warn  — unexpected but recoverable (stale data, missing resources, invalid input)
 *   error — operation failed (database error, API failure, critical issues)
 *   debug — high-frequency noise (detailed traces, verbose data) — off in production
 *
 * Usage:
 *   const logger = require('./helpers/logger');
 *   
 *   // Use default context
 *   logger.info('Server started', { port: 3000 });
 *   
 *   // Create context-specific logger
 *   const authLogger = logger.context('auth');
 *   authLogger.info('User logged in', { userId: 123 });
 */

const IS_DEBUG = process.env.NODE_ENV !== 'production';

function fmt(context, level, message, data) {
  const ts = new Date().toISOString();
  const dataStr = data && Object.keys(data).length > 0
    ? '  ' + JSON.stringify(data)
    : '';
  return `[${context}] ${level.toUpperCase().padEnd(5)} ${ts}  ${message}${dataStr}`;
}

class Logger {
  constructor(context = 'app') {
    this.contextName = context;
  }

  /**
   * Create a new logger instance with a specific context
   * @param {string} context - Context name (e.g., 'auth', 'socket', 'cache')
   * @returns {Logger}
   */
  context(context) {
    return new Logger(context);
  }

  info(message, data = {}) {
    console.log(fmt(this.contextName, 'info', message, data));
  }

  warn(message, data = {}) {
    console.warn(fmt(this.contextName, 'warn', message, data));
  }

  error(message, data = {}) {
    console.error(fmt(this.contextName, 'error', message, data));
  }

  debug(message, data = {}) {
    if (IS_DEBUG) {
      console.log(fmt(this.contextName, 'debug', message, data));
    }
  }

  /**
   * Log with custom level
   * @param {string} level - Custom level name
   * @param {string} message - Log message
   * @param {object} data - Additional data
   */
  log(level, message, data = {}) {
    console.log(fmt(this.contextName, level, message, data));
  }
}

// Export default logger instance
const logger = new Logger('app');

// Export context-specific loggers for common use cases
logger.presence = new Logger('presence');
logger.socket = new Logger('socket');
logger.cache = new Logger('cache');
logger.auth = new Logger('auth');
logger.api = new Logger('api');
logger.db = new Logger('db');

// Backward compatibility: export presenceLogger
const presenceLogger = logger.presence;

module.exports = logger;
module.exports.presenceLogger = presenceLogger;
