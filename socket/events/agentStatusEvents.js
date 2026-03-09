/**
 * Agent Status Event Handlers
 * Handles all agent status-related socket events (accepting_chats, not_accepting_chats, offline)
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
    socket.on('agentOnline', async (data) => {
      await this.agentStatusHandler.handleAgentOnline(socket, data);
    });

    socket.on('agentHeartbeat', async (data) => {
      await this.agentStatusHandler.handleAgentHeartbeat(socket, data);
    });

    socket.on('agentOffline', async (data) => {
      await this.agentStatusHandler.handleAgentOffline(socket, data);
    });

    socket.on('updateAgentStatus', async (data) => {
      await this.agentStatusHandler.handleUpdateAgentStatus(socket, data);
    });

    socket.on('getAgentStatuses', () => {
      this.agentStatusHandler.handleGetAgentStatuses(socket);
    });
  }
}

module.exports = AgentStatusEvents;
