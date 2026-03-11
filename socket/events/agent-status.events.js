/**
 * Agent Status Event Handlers
 * Handles all agent status-related socket events (accepting_chats, not_accepting_chats, offline)
 */
const EVENTS = require('../constants/events');

class AgentStatusEvents {
  constructor(agentStatusHandler) {
    this.agentStatusHandler = agentStatusHandler;
  }

  /**
   * Register all agent status event listeners
   * @param {Object} socket - Socket instance
   */
  register(socket) {
    socket.on(EVENTS.AGENT_ONLINE, async (data) => {
      // Join department rooms for agents
      if (socket.user && socket.user.userType === 'agent') {
        const RoomManagementService = require('../services/room-management.service');
        await RoomManagementService.joinDepartmentRooms(socket);
      }
      
      await this.agentStatusHandler.handleAgentOnline(socket, data);
    });

    socket.on(EVENTS.AGENT_HEARTBEAT, async (data) => {
      await this.agentStatusHandler.handleAgentHeartbeat(socket, data);
    });

    socket.on(EVENTS.AGENT_OFFLINE, async (data) => {
      await this.agentStatusHandler.handleAgentOffline(socket, data);
    });

    socket.on(EVENTS.UPDATE_AGENT_STATUS, async (data) => {
      await this.agentStatusHandler.handleUpdateAgentStatus(socket, data);
    });

    socket.on(EVENTS.GET_AGENT_STATUSES, () => {
      this.agentStatusHandler.handleGetAgentStatuses(socket);
    });
  }
}

module.exports = AgentStatusEvents;
