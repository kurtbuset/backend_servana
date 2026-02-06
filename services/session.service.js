const crypto = require('crypto');

class SessionService {
  constructor() {
    this.SESSION_PREFIX = 'session:';
    this.USER_SESSIONS_PREFIX = 'user_sessions:';
    this.SESSION_EXPIRY = 24 * 60 * 60; // 24 hours in seconds
  }

  /**
   * Generate a unique session ID
   */
  generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new session for a user
   */
  async createSession(redisClient, userId, userData = {}) {
    try {
      const sessionId = this.generateSessionId();
      const sessionKey = `${this.SESSION_PREFIX}${sessionId}`;
      const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;

      // Session data to store
      const sessionData = {
        userId: userId,
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        ...userData
      };

      // Store session data with expiry
      await redisClient.setEx(sessionKey, this.SESSION_EXPIRY, JSON.stringify(sessionData));
      
      // Add session to user's session list
      await redisClient.sAdd(userSessionsKey, sessionId);
      await redisClient.expire(userSessionsKey, this.SESSION_EXPIRY);

      console.log(`✅ Redis: Created session ${sessionId} for user ${userId}`);
      
      return sessionId;
    } catch (error) {
      console.error('❌ Redis: Failed to create session:', error.message);
      throw error;
    }
  }

  /**
   * Get session data by session ID
   */
  async getSession(redisClient, sessionId) {
    try {
      const sessionKey = `${this.SESSION_PREFIX}${sessionId}`;
      const sessionData = await redisClient.get(sessionKey);

      if (!sessionData) {
        console.log(`⚠️ Redis: Session ${sessionId} not found or expired`);
        return null;
      }

      const parsedData = JSON.parse(sessionData);
      
      // Update last accessed time
      parsedData.lastAccessed = new Date().toISOString();
      await redisClient.setEx(sessionKey, this.SESSION_EXPIRY, JSON.stringify(parsedData));

      console.log(`✅ Redis: Retrieved session ${sessionId} for user ${parsedData.userId}`);
      
      return parsedData;
    } catch (error) {
      console.error('❌ Redis: Failed to get session:', error.message);
      return null;
    }
  }

  /**
   * Delete a specific session
   */
  async deleteSession(redisClient, sessionId) {
    try {
      const sessionKey = `${this.SESSION_PREFIX}${sessionId}`;
      
      // Get session data to find user ID
      const sessionData = await redisClient.get(sessionKey);
      if (sessionData) {
        const { userId } = JSON.parse(sessionData);
        const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;
        
        // Remove session from user's session list
        await redisClient.sRem(userSessionsKey, sessionId);
      }

      // Delete the session
      const result = await redisClient.del(sessionKey);
      
      console.log(`✅ Redis: Deleted session ${sessionId}`);
      
      return result > 0;
    } catch (error) {
      console.error('❌ Redis: Failed to delete session:', error.message);
      return false;
    }
  }

  /**
   * Delete all sessions for a user
   */
  async deleteUserSessions(redisClient, userId) {
    try {
      const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;
      
      // Get all session IDs for the user
      const sessionIds = await redisClient.sMembers(userSessionsKey);
      
      if (sessionIds.length === 0) {
        console.log(`⚠️ Redis: No sessions found for user ${userId}`);
        return 0;
      }

      // Delete all session data
      const sessionKeys = sessionIds.map(id => `${this.SESSION_PREFIX}${id}`);
      const deletedCount = await redisClient.del(sessionKeys);
      
      // Delete user sessions list
      await redisClient.del(userSessionsKey);

      console.log(`✅ Redis: Deleted ${deletedCount} sessions for user ${userId}`);
      
      return deletedCount;
    } catch (error) {
      console.error('❌ Redis: Failed to delete user sessions:', error.message);
      return 0;
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(redisClient, userId) {
    try {
      const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;
      const sessionIds = await redisClient.sMembers(userSessionsKey);

      if (sessionIds.length === 0) {
        return [];
      }

      const sessions = [];
      for (const sessionId of sessionIds) {
        const sessionData = await this.getSession(redisClient, sessionId);
        if (sessionData) {
          sessions.push({ sessionId, ...sessionData });
        }
      }

      console.log(`✅ Redis: Retrieved ${sessions.length} sessions for user ${userId}`);
      
      return sessions;
    } catch (error) {
      console.error('❌ Redis: Failed to get user sessions:', error.message);
      return [];
    }
  }
}

module.exports = new SessionService();