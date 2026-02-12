const { cacheManager } = require('../helpers/redisClient');

/**
 * Cache Service - High-level caching operations for business logic
 * Uses the centralized cache manager for all operations
 * NOTE: This service only handles caching operations, not database queries
 */
class CacheService {
  constructor() {
    this.cache = cacheManager;
  }

  /**
   * USER PROFILE CACHING (Cache-Aside)
   */
  
  async getUserProfile(userId, userType = 'agent') {
    const prefix = userType === 'client' ? 'CLIENT_PROFILE' : 'USER_PROFILE';
    return await this.cache.get(prefix, userId);
  }

  async setUserProfile(userId, profileData, userType = 'agent') {
    const prefix = userType === 'client' ? 'CLIENT_PROFILE' : 'USER_PROFILE';
    return await this.cache.set(prefix, userId, profileData);
  }

  async invalidateUserProfile(userId, userType = 'agent') {
    const prefix = userType === 'client' ? 'CLIENT_PROFILE' : 'USER_PROFILE';
    return await this.cache.delete(prefix, userId);
  }

  /**
   * DEPARTMENT CACHING (Write-Through with 4-hour TTL)
   */
  
  async getDepartments() {
    // Cache-first approach: return cache data if found, null if not found
    let departments = await this.cache.get('DEPARTMENT', 'all');
    
    if (departments !== null && departments !== undefined) {
      return departments;
    }
    
    console.log('⚠️ Cache MISS: No departments found in cache');
    return null; // Let the service handle database fetching
  }

  async updateDepartments(departments) {
    // Write-through: Cache the departments with 4-hour TTL
    const result = await this.cache.set('DEPARTMENT', 'all', departments);
    if (result) {
      console.log(`✅ Write-through: Cached ${departments.length} departments with 4-hour TTL`);
    }
    return result;
  }

  async invalidateDepartments() {
    const result = await this.cache.delete('DEPARTMENT', 'all');
    if (result) {
      console.log('🧹 Invalidated departments cache');
    }
    return result;
  }

  /**
   * ROLE CACHING (Write-Through)
   */
  
  async getRoles() {
    return await this.cache.get('ROLE', 'all');
  }

  async updateRoles(roles) {
    const result = await this.cache.set('ROLE', 'all', roles);
    if (result) {
      console.log(`✅ Write-through: Cached ${roles.length} roles`);
    }
    return result;
  }

  async invalidateRoles() {
    return await this.cache.delete('ROLE', 'all');
  }

  /**
   * CANNED MESSAGES CACHING (Cache-Aside)
   */
  
  async getCannedMessages(roleId, userId = null) {
    const cacheKey = userId ? `${roleId}_${userId}` : roleId;
    return await this.cache.get('CANNED_MESSAGES', cacheKey);
  }

  async setCannedMessages(roleId, messages, userId = null) {
    const cacheKey = userId ? `${roleId}_${userId}` : roleId;
    const result = await this.cache.set('CANNED_MESSAGES', cacheKey, messages);
    if (result) {
      console.log(`✅ Cached ${messages.length} canned messages for role ${roleId}${userId ? ` and user ${userId}` : ''}`);
    }
    return result;
  }

  async invalidateCannedMessages(roleId, userId = null) {
    const cacheKey = userId ? `${roleId}_${userId}` : roleId;
    return await this.cache.delete('CANNED_MESSAGES', cacheKey);
  }

  /**
   * AUTO-REPLY CACHING (Write-Through with 2-hour TTL)
   */
  
  async getAutoReplies() {
    return await this.cache.get('AUTO_REPLY', 'all');
  }

  async updateAutoReplies(autoReplies) {
    const result = await this.cache.set('AUTO_REPLY', 'all', autoReplies);
    if (result) {
      console.log(`✅ Write-through: Cached ${autoReplies.length} auto-replies with 2-hour TTL`);
    }
    return result;
  }

  async invalidateAutoReplies() {
    const result = await this.cache.delete('AUTO_REPLY', 'all');
    if (result) {
      console.log('🧹 Invalidated auto-replies cache');
    }
    return result;
  }

  /**
   * AGENT CACHING (Write-Through with 2-hour TTL)
   */
  
  async getAgents() {
    return await this.cache.get('AGENT', 'all');
  }

  async updateAgents(agents) {
    const result = await this.cache.set('AGENT', 'all', agents);
    if (result) {
      console.log(`✅ Write-through: Cached ${agents.length} agents with 2-hour TTL`);
    }
    return result;
  }

  async invalidateAgents() {
    const result = await this.cache.delete('AGENT', 'all');
    if (result) {
      console.log('🧹 Invalidated agents cache');
    }
    return result;
  }

  /**
   * CHANGE-ROLE CACHING (Write-Through with 1-hour TTL)
   */
  
  async getUsersWithRoles() {
    return await this.cache.get('CHANGE_ROLE', 'users_with_roles');
  }

  async updateUsersWithRoles(usersWithRoles) {
    const result = await this.cache.set('CHANGE_ROLE', 'users_with_roles', usersWithRoles);
    if (result) {
      console.log(`✅ Write-through: Cached ${usersWithRoles.length} users with roles with 1-hour TTL`);
    }
    return result;
  }

  async invalidateUsersWithRoles() {
    const result = await this.cache.delete('CHANGE_ROLE', 'users_with_roles');
    if (result) {
      console.log('🧹 Invalidated users with roles cache');
    }
    return result;
  }

  /**
   * CHAT MESSAGE CACHING (Cache-Aside)
   */
  
  async getChatMessages(chatGroupId, limit = 50) {
    return await this.cache.get('CHAT_MESSAGES', chatGroupId) || [];
  }

  async cacheChatMessages(chatGroupId, messages, limit = 50) {
    const recentMessages = messages.slice(-limit);
    return await this.cache.set('CHAT_MESSAGES', chatGroupId, recentMessages);
  }

  async invalidateChatMessages(chatGroupId) {
    return await this.cache.delete('CHAT_MESSAGES', chatGroupId);
  }

  /**
   * CHAT GROUP CACHING (Cache-Aside)
   */
  
  async getChatGroup(chatGroupId) {
    return await this.cache.get('CHAT_GROUP', chatGroupId);
  }

  async cacheChatGroup(chatGroupId, chatGroupData) {
    return await this.cache.set('CHAT_GROUP', chatGroupId, chatGroupData);
  }

  async invalidateChatGroup(chatGroupId) {
    return await this.cache.delete('CHAT_GROUP', chatGroupId);
  }

  /**
   * ONLINE USER MANAGEMENT (In-Memory Only)
   */
  
  async setUserOnline(userId, userData) {
    return await this.cache.setUserOnline(userId, userData);
  }

  async setUserOffline(userId) {
    return await this.cache.setUserOffline(userId);
  }

  async getOnlineUsers() {
    return await this.cache.getOnlineUsers();
  }

  async getUserStatus(userId) {
    return await this.cache.get('USER_STATUS', userId);
  }

  /**
   * TYPING INDICATORS (Short-lived)
   */
  
  async setTyping(chatGroupId, userId, isTyping = true) {
    if (isTyping) {
      return await this.cache.set('TYPING', chatGroupId, { userId, timestamp: Date.now() }, 10);
    } else {
      return await this.cache.delete('TYPING', chatGroupId);
    }
  }

  async getTyping(chatGroupId) {
    return await this.cache.get('TYPING', chatGroupId);
  }

  /**
   * RATE LIMITING
   */
  
  async checkRateLimit(identifier, limit = 100, windowSeconds = 3600) {
    return await this.cache.checkRateLimit(identifier, limit, windowSeconds);
  }

  /**
   * SYSTEM CONFIGURATION (Write-Through)
   */
  
  async getSystemConfig(configKey) {
    return await this.cache.get('SYSTEM_CONFIG', configKey);
  }

  async setSystemConfig(configKey, configValue) {
    return await this.cache.set('SYSTEM_CONFIG', configKey, configValue);
  }

  /**
   * BULK OPERATIONS
   */
  
  async invalidateUserData(userId, userType = 'agent') {
    const promises = [
      this.invalidateUserProfile(userId, userType),
      this.cache.deleteUserSessions(userId)
    ];
    
    await Promise.all(promises);
    console.log(`🧹 Invalidated all cache data for ${userType} ${userId}`);
  }

  async invalidateAllDepartmentData() {
    const promises = [
      this.invalidateDepartments(),
      this.cache.delete('CANNED_MESSAGES', '*') // Would need pattern delete
    ];
    
    await Promise.all(promises);
    console.log('🧹 Invalidated all department-related cache data');
  }

  /**
   * CACHE STATISTICS AND HEALTH
   */
  
  async getCacheStats() {
    return await this.cache.getStats();
  }

  async healthCheck() {
    return await this.cache.healthCheck();
  }

  async cleanup() {
    return await this.cache.cleanup();
  }
}

module.exports = new CacheService();