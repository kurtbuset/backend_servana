/**
 * Agent Status Manager
 * Manages periodic checks for idle agents and cleanup tasks
 */
class AgentStatusManager {
  constructor(io, agentStatusHandler) {
    this.io = io;
    this.agentStatusHandler = agentStatusHandler;
    this.idleCheckInterval = null;
    this.cleanupInterval = null;
  }

  /**
   * Start the manager
   */
  start() {
    console.log('🚀 Starting Agent Status Manager');

    // Check for idle agents every minute (more frequent checks for accuracy)
    this.idleCheckInterval = setInterval(async () => {
      try {
        await this.agentStatusHandler.checkIdleAgents();
      } catch (error) {
        console.error('❌ Error checking idle agents:', error);
      }
    }, 60 * 1000); // 1 minute

    // Cleanup rate limits every 5 minutes
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.agentStatusHandler.cleanupRateLimits();
      } catch (error) {
        console.error('❌ Error cleaning up rate limits:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Stop the manager
   */
  stop() {
    console.log('🛑 Stopping Agent Status Manager');
    
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

module.exports = AgentStatusManager;
