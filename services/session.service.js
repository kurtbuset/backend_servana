const crypto = require('crypto');

/**
 * Session Service - Now uses centralized cache manager
 */
class SessionService {
  constructor() {
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
  async createSession(cache, userId, userData = {}) {
    try {
      const sessionId = this.generateSessionId();
      
      const sessionData = {
        userId,
        ...userData,
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString()
      };

      await cache.createSession(sessionId, userId, sessionData);
      
      console.log(`✅ Session: Created session ${sessionId} for user ${userId}`);
      
      return sessionId;
    } catch (error) {
      console.error('❌ Session: Failed to create session:', error.message);
      throw error;
    }
  }

  /**
   * Get session data by session ID
   */
  async getSession(cache, sessionId) {
    try {
      const sessionData = await cache.getSession(sessionId);

      if (!sessionData) {
        console.log(`⚠️ Session: Session ${sessionId} not found or expired`);
        return null;
      }

      console.log(`✅ Session: Retrieved session ${sessionId} for user ${sessionData.userId}`);
      
      return sessionData;
    } catch (error) {
      console.error('❌ Session: Failed to get session:', error.message);
      return null;
    }
  }

  /**
   * Delete a specific session
   */
  async deleteSession(cache, sessionId) {
    try {
      const result = await cache.deleteSession(sessionId);
      
      console.log(`✅ Session: Deleted session ${sessionId}`);  
      
      return result;
    } catch (error) {
      console.error('❌ Session: Failed to delete session:', error.message);
      return false;
    }
  }

  /**
   * Delete all sessions for a user
   */
  async deleteUserSessions(cache, userId) {
    try {
      const deletedCount = await cache.deleteUserSessions(userId);

      console.log(`✅ Session: Deleted ${deletedCount} sessions for user ${userId}`);
      
      return deletedCount;
    } catch (error) {
      console.error('❌ Session: Failed to delete user sessions:', error.message);
      return 0;
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(cache, userId) {
    try {
      const sessionIds = await cache.getSetMembers('USER_SESSIONS', userId);

      if (sessionIds.length === 0) {
        return [];
      }

      const sessions = [];
      for (const sessionId of sessionIds) {
        const sessionData = await cache.getSession(sessionId);
        if (sessionData) {
          sessions.push({ sessionId, ...sessionData });
        }
      }

      console.log(`✅ Session: Retrieved ${sessions.length} sessions for user ${userId}`);
      
      return sessions;
    } catch (error) {
      console.error('❌ Session: Failed to get user sessions:', error.message);
      return [];
    }
  }
}

module.exports = new SessionService();