/**
 * Agent Status Event Handlers
 * Handles all agent status-related socket events (accepting chats, not accepting)
 */
class AgentStatusEvents {
  constructor(agentStatusHandler) {
    this.agentStatusHandler = agentStatusHandler;
  }

  /**
   * Register all agent status event listeners
   * @param {Object} socket - Socket instance
   */
  register(socket) {
    socket.on('updateAgentStatus', async (data) => {
      await this.agentStatusHandler.handleUpdateAgentStatus(socket, data);
    });
  }
}

module.exports = AgentStatusEvents;
