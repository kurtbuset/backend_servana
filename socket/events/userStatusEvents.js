/**
 * User Status Event Handlers
 * Handles all user status-related socket events (online, offline, heartbeat)
 */
class UserStatusEvents {
  constructor(userStatusHandler) {
    this.userStatusHandler = userStatusHandler;
  }

  /**
   * Register all user status event listeners
   * @param {Object} socket - Socket instance
   */
  register(socket) {
    socket.on('userOnline', async (data) => {
      await this.userStatusHandler.handleUserOnline(socket, data);
    });

    socket.on('userHeartbeat', async (data) => {
      await this.userStatusHandler.handleUserHeartbeat(socket, data);
    });

    socket.on('userOffline', async (data) => {
      await this.userStatusHandler.handleUserOffline(socket, data);
    });

    socket.on('getOnlineUsers', () => {
      this.userStatusHandler.handleGetOnlineUsers(socket);
    });
  }
}

module.exports = UserStatusEvents;
