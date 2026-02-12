const redis = require('redis');

/**
 * Centralized Redis Cache Manager
 * Handles all caching operations with structured key management and TTL policies
 */
class RedisCacheManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    
    // Cache key prefixes for organization
    this.keyPrefixes = {
      SESSION: 'session:',
      USER_SESSIONS: 'user_sessions:',
      USER_PROFILE: 'user_profile:',
      CLIENT_PROFILE: 'client_profile:',
      CHAT_MESSAGES: 'chat_messages:',
      CHAT_GROUP: 'chat_group:',
      DEPARTMENT: 'department:',
      ROLE: 'role:',
      AGENT: 'agent:',
      AUTO_REPLY: 'auto_reply:',
      CHANGE_ROLE: 'change_role:',
      CANNED_MESSAGES: 'canned_messages:',
      ONLINE_USERS: 'online_users:',
      USER_STATUS: 'user_status:',
      TYPING: 'typing:',
      RATE_LIMIT: 'rate_limit:',
      SYSTEM_CONFIG: 'system_config:'
    };

    // TTL policies (in seconds)
    this.ttlPolicies = {
      SESSION: 24 * 60 * 60,           // 24 hours
      USER_PROFILE: 60 * 60,           // 1 hour
      CHAT_MESSAGES: 2 * 60 * 60,      // 2 hours
      CHAT_GROUP: 30 * 60,             // 30 minutes
      DEPARTMENT: 4 * 60 * 60,         // 4 hours (write-through cache strategy)
      ROLE: 24 * 60 * 60,              // 24 hours (rarely changes)
      AGENT: 2 * 60 * 60,              // 2 hours (moderate change frequency)
      AUTO_REPLY: 2 * 60 * 60,         // 2 hours (moderate change frequency)
      CHANGE_ROLE: 60 * 60,            // 1 hour (user role changes moderately)
      CANNED_MESSAGES: 60 * 60,        // 1 hour
      ONLINE_USERS: 60,                // 1 minute (real-time data)
      USER_STATUS: 45,                 // 45 seconds (heartbeat data)
      TYPING: 10,                      // 10 seconds (typing indicators)
      RATE_LIMIT: 60 * 60,             // 1 hour
      SYSTEM_CONFIG: 12 * 60 * 60      // 12 hours
    };
  }

  /**
   * Initialize Redis connection
   */
  async connect() {
    try {
      const host = process.env.REDIS_HOST || 'localhost';
      const port = process.env.REDIS_PORT || 6379;
      const password = process.env.REDIS_PASSWORD || undefined;

      console.log('🔧 Redis configuration:');
      console.log('   Host:', host, process.env.REDIS_HOST ? '(from env)' : '(default)');
      console.log('   Port:', port, process.env.REDIS_PORT ? '(from env)' : '(default)');
      console.log('   Password:', password ? '***' : 'none', process.env.REDIS_PASSWORD ? '(from env)' : '(default)');

      this.client = redis.createClient({
        host: host,
        port: port,
        password: password,
      });

      await this.client.connect();
      this.isConnected = true;
      console.log('✅ Redis Cache Manager connected successfully!');
      
      return this;
    } catch (error) {
      console.log('❌ Redis connection failed:', error.message);
      this.isConnected = false;
      return null;
    }
  }

  /**
   * Generate structured cache key
   */
  generateKey(prefix, identifier, subKey = null) {
    const baseKey = `${this.keyPrefixes[prefix]}${identifier}`;
    return subKey ? `${baseKey}:${subKey}` : baseKey;
  }

  /**
   * CACHE-ASIDE OPERATIONS
   * For frequently accessed data with unpredictable patterns
   */

  // Generic cache-aside get
  async get(prefix, identifier, subKey = null) {
    if (!this.isConnected) return null;
    
    try {
      const key = this.generateKey(prefix, identifier, subKey);
      const data = await this.client.get(key);
      
      if (data) {
        console.log(`✅ Cache HIT: ${key}`);
        return JSON.parse(data);
      }
      
      console.log(`⚠️ Cache MISS: ${key}`);
      return null;
    } catch (error) {
      console.error(`❌ Cache GET error for ${prefix}:`, error.message);
      return null;
    }
  }

  // Generic cache-aside set
  async set(prefix, identifier, data, customTTL = null, subKey = null) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey(prefix, identifier, subKey);
      const ttl = customTTL || this.ttlPolicies[prefix];
      
      await this.client.setEx(key, ttl, JSON.stringify(data));
      console.log(`✅ Cache SET: ${key} (TTL: ${ttl}s)`);
      return true;
    } catch (error) {
      console.error(`❌ Cache SET error for ${prefix}:`, error.message);
      return false;
    }
  }

  // Generic cache delete
  async delete(prefix, identifier, subKey = null) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey(prefix, identifier, subKey);
      const result = await this.client.del(key);
      console.log(`✅ Cache DELETE: ${key}`);
      return result > 0;
    } catch (error) {
      console.error(`❌ Cache DELETE error for ${prefix}:`, error.message);
      return false;
    }
  }

  /**
   * WRITE-THROUGH OPERATIONS
   * For critical data that must stay consistent
   */

  // Write-through set (cache + database)
  async setWriteThrough(prefix, identifier, data, dbUpdateFn, customTTL = null, subKey = null) {
    if (!this.isConnected) {
      // If cache unavailable, still update database
      try {
        await dbUpdateFn(data);
        return true;
      } catch (error) {
        console.error(`❌ Database update failed for ${prefix}:`, error.message);
        return false;
      }
    }

    try {
      // Update database first
      await dbUpdateFn(data);
      
      // Then update cache
      const key = this.generateKey(prefix, identifier, subKey);
      const ttl = customTTL || this.ttlPolicies[prefix];
      
      await this.client.setEx(key, ttl, JSON.stringify(data));
      console.log(`✅ Write-through SET: ${key} (TTL: ${ttl}s)`);
      return true;
    } catch (error) {
      console.error(`❌ Write-through error for ${prefix}:`, error.message);
      return false;
    }
  }

  /**
   * SET OPERATIONS
   * For managing collections (online users, user sessions, etc.)
   */

  // Add to set
  async addToSet(prefix, identifier, member, ttl = null) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey(prefix, identifier);
      await this.client.sAdd(key, member);
      
      if (ttl || this.ttlPolicies[prefix]) {
        await this.client.expire(key, ttl || this.ttlPolicies[prefix]);
      }
      
      console.log(`✅ Added to SET: ${key} -> ${member}`);
      return true;
    } catch (error) {
      console.error(`❌ SET ADD error for ${prefix}:`, error.message);
      return false;
    }
  }

  // Remove from set
  async removeFromSet(prefix, identifier, member) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey(prefix, identifier);
      const result = await this.client.sRem(key, member);
      console.log(`✅ Removed from SET: ${key} -> ${member}`);
      return result > 0;
    } catch (error) {
      console.error(`❌ SET REMOVE error for ${prefix}:`, error.message);
      return false;
    }
  }

  // Get set members
  async getSetMembers(prefix, identifier) {
    if (!this.isConnected) return [];
    
    try {
      const key = this.generateKey(prefix, identifier);
      const members = await this.client.sMembers(key);
      console.log(`✅ Retrieved SET: ${key} (${members.length} members)`);
      return members;
    } catch (error) {
      console.error(`❌ SET GET error for ${prefix}:`, error.message);
      return [];
    }
  }

  /**
   * HASH OPERATIONS
   * For structured data with multiple fields
   */

  // Set hash field
  async setHashField(prefix, identifier, field, value, ttl = null) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey(prefix, identifier);
      await this.client.hSet(key, field, JSON.stringify(value));
      
      if (ttl || this.ttlPolicies[prefix]) {
        await this.client.expire(key, ttl || this.ttlPolicies[prefix]);
      }
      
      console.log(`✅ Hash SET: ${key}.${field}`);
      return true;
    } catch (error) {
      console.error(`❌ Hash SET error for ${prefix}:`, error.message);
      return false;
    }
  }

  // Get hash field
  async getHashField(prefix, identifier, field) {
    if (!this.isConnected) return null;
    
    try {
      const key = this.generateKey(prefix, identifier);
      const value = await this.client.hGet(key, field);
      
      if (value) {
        console.log(`✅ Hash GET: ${key}.${field}`);
        return JSON.parse(value);
      }
      
      return null;
    } catch (error) {
      console.error(`❌ Hash GET error for ${prefix}:`, error.message);
      return null;
    }
  }

  // Get all hash fields
  async getHashAll(prefix, identifier) {
    if (!this.isConnected) return null;
    
    try {
      const key = this.generateKey(prefix, identifier);
      const hash = await this.client.hGetAll(key);
      
      if (Object.keys(hash).length > 0) {
        const parsed = {};
        for (const [field, value] of Object.entries(hash)) {
          parsed[field] = JSON.parse(value);
        }
        console.log(`✅ Hash GET ALL: ${key}`);
        return parsed;
      }
      
      return null;
    } catch (error) {
      console.error(`❌ Hash GET ALL error for ${prefix}:`, error.message);
      return null;
    }
  }

  /**
   * SPECIALIZED METHODS FOR COMMON OPERATIONS
   */

  // Session management
  async createSession(sessionId, userId, userData) {
    const sessionData = {
      userId,
      ...userData,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    };

    await this.set('SESSION', sessionId, sessionData);
    await this.addToSet('USER_SESSIONS', userId, sessionId);
    
    return sessionId;
  }

  async getSession(sessionId) {
    const sessionData = await this.get('SESSION', sessionId);
    
    if (sessionData) {
      // Update last accessed time
      sessionData.lastAccessed = new Date().toISOString();
      await this.set('SESSION', sessionId, sessionData);
    }
    
    return sessionData;
  }

  async deleteSession(sessionId) {
    const sessionData = await this.get('SESSION', sessionId);
    
    if (sessionData) {
      await this.removeFromSet('USER_SESSIONS', sessionData.userId, sessionId);
    }
    
    return await this.delete('SESSION', sessionId);
  }

  async deleteUserSessions(userId) {
    const sessionIds = await this.getSetMembers('USER_SESSIONS', userId);
    
    let deletedCount = 0;
    for (const sessionId of sessionIds) {
      if (await this.delete('SESSION', sessionId)) {
        deletedCount++;
      }
    }
    
    await this.delete('USER_SESSIONS', userId);
    return deletedCount;
  }

  // Online user management
  async setUserOnline(userId, userData) {
    const onlineData = {
      ...userData,
      lastSeen: new Date(),
      status: 'online'
    };
    
    await this.setHashField('ONLINE_USERS', 'active', userId, onlineData);
    await this.set('USER_STATUS', userId, onlineData, this.ttlPolicies.USER_STATUS);
  }

  async setUserOffline(userId) {
    const userData = await this.getHashField('ONLINE_USERS', 'active', userId);
    
    if (userData) {
      userData.status = 'offline';
      userData.lastSeen = new Date();
      
      await this.client.hDel(this.generateKey('ONLINE_USERS', 'active'), userId);
      await this.set('USER_STATUS', userId, userData, this.ttlPolicies.USER_STATUS);
    }
  }

  async getOnlineUsers() {
    return await this.getHashAll('ONLINE_USERS', 'active') || {};
  }

  // Chat message caching
  async cacheRecentMessages(chatGroupId, messages, limit = 50) {
    const recentMessages = messages.slice(-limit);
    await this.set('CHAT_MESSAGES', chatGroupId, recentMessages);
  }

  async getRecentMessages(chatGroupId) {
    return await this.get('CHAT_MESSAGES', chatGroupId) || [];
  }

  // Department/Role caching (write-through)
  async cacheDepartments(departments, dbUpdateFn = null) {
    if (dbUpdateFn) {
      return await this.setWriteThrough('DEPARTMENT', 'all', departments, dbUpdateFn);
    } else {
      return await this.set('DEPARTMENT', 'all', departments);
    }
  }

  async getCachedDepartments() {
    return await this.get('DEPARTMENT', 'all');
  }

  // Rate limiting
  async checkRateLimit(identifier, limit, windowSeconds) {
    if (!this.isConnected) return true; // Allow if cache unavailable
    
    try {
      const key = this.generateKey('RATE_LIMIT', identifier);
      const current = await this.client.incr(key);
      
      if (current === 1) {
        await this.client.expire(key, windowSeconds);
      }
      
      const allowed = current <= limit;
      console.log(`🚦 Rate limit check: ${identifier} (${current}/${limit}) - ${allowed ? 'ALLOWED' : 'BLOCKED'}`);
      
      return allowed;
    } catch (error) {
      console.error(`❌ Rate limit error:`, error.message);
      return true; // Allow on error
    }
  }

  // Cleanup operations
  async cleanup() {
    if (!this.isConnected) return;
    
    try {
      // Clean expired typing indicators
      const typingKeys = await this.client.keys(this.generateKey('TYPING', '*'));
      if (typingKeys.length > 0) {
        await this.client.del(typingKeys);
        console.log(`🧹 Cleaned ${typingKeys.length} expired typing indicators`);
      }
    } catch (error) {
      console.error('❌ Cleanup error:', error.message);
    }
  }

  // Health check
  async healthCheck() {
    if (!this.isConnected) return false;
    
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      console.error('❌ Redis health check failed:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  // Get cache statistics
  async getStats() {
    if (!this.isConnected) return null;
    
    try {
      const info = await this.client.info('memory');
      const keyCount = await this.client.dbSize();
      
      return {
        connected: this.isConnected,
        keyCount,
        memoryInfo: info
      };
    } catch (error) {
      console.error('❌ Stats error:', error.message);
      return null;
    }
  }
}

// Create singleton instance
const cacheManager = new RedisCacheManager();

// Legacy compatibility function
async function connectRedis() {
  return await cacheManager.connect();
}

module.exports = { 
  connectRedis,
  RedisCacheManager,
  cacheManager
};                              