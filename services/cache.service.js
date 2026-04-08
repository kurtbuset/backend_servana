const { cacheManager } = require("../helpers/redisClient");

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

  async getUserProfile(userId, userType = "agent") {
    const prefix = userType === "client" ? "CLIENT_PROFILE" : "USER_PROFILE";
    return await this.cache.get(prefix, userId);
  }

  async setUserProfile(userId, profileData, userType = "agent") {
    const prefix = userType === "client" ? "CLIENT_PROFILE" : "USER_PROFILE";
    return await this.cache.set(prefix, userId, profileData);
  }

  async invalidateUserProfile(userId, userType = "agent") {
    const prefix = userType === "client" ? "CLIENT_PROFILE" : "USER_PROFILE";
    return await this.cache.delete(prefix, userId);
  }

  async invalidateUserDepartments(userId) {
    return await this.cache.delete("USER_PROFILE", `user_depts_${userId}`);
  }

  /**
   * DEPARTMENT CACHING (Write-Through with 4-hour TTL)
   */

  async getDepartments() {
    // Cache-first approach: return cache data if found, null if not found
    let departments = await this.cache.get("DEPARTMENT", "all");

    if (departments !== null && departments !== undefined) {
      return departments;
    }

    return null; // Let the service handle database fetching
  }

  async updateDepartments(departments) {
    // Write-through: Cache the departments with 4-hour TTL
    return await this.cache.set("DEPARTMENT", "all", departments);
  }

  async invalidateDepartments() {
    return await this.cache.delete("DEPARTMENT", "all");
  }

  /**
   * ROLE CACHING (Write-Through)
   */

  async getRoles() {
    return await this.cache.get("ROLE", "all");
  }

  async updateRoles(roles) {
    return await this.cache.set("ROLE", "all", roles);
  }

  async invalidateRoles() {
    return await this.cache.delete("ROLE", "all");
  }

  /**
   * CANNED MESSAGES CACHING (Cache-Aside)
   */

  async getCannedMessages(roleId, userId = null) {
    const cacheKey = userId ? `${roleId}_${userId}` : roleId;
    return await this.cache.get("CANNED_MESSAGES", cacheKey);
  }

  async setCannedMessages(roleId, messages, userId = null) {
    const cacheKey = userId ? `${roleId}_${userId}` : roleId;
    return await this.cache.set("CANNED_MESSAGES", cacheKey, messages);
  }

  async invalidateCannedMessages(roleId, userId = null) {
    if (roleId) {
      const cacheKey = userId ? `${roleId}_${userId}` : roleId;
      return await this.cache.delete("CANNED_MESSAGES", cacheKey);
    }
    // If no roleId provided, invalidate all canned message keys
    return await this.cache.deleteByPrefix("CANNED_MESSAGES");
  }

  /**
   * AUTO-REPLY CACHING (Write-Through with 2-hour TTL)
   */

  async getAutoReplies() {
    return await this.cache.get("AUTO_REPLY", "all");
  }

  async updateAutoReplies(autoReplies) {
    return await this.cache.set("AUTO_REPLY", "all", autoReplies);
  }

  async invalidateAutoReplies() {
    return await this.cache.delete("AUTO_REPLY", "all");
  }

  /**
   * AGENT CACHING (Write-Through with 2-hour TTL)
   */

  async getAgents() {
    return await this.cache.get("AGENT", "all");
  }

  async updateAgents(agents) {
    return await this.cache.set("AGENT", "all", agents);
  }

  async invalidateAgents() {
    return await this.cache.delete("AGENT", "all");
  }

  /**
   * CHANGE-ROLE CACHING (Write-Through with 1-hour TTL)
   */

  async getUsersWithRoles() {
    return await this.cache.get("CHANGE_ROLE", "users_with_roles");
  }

  async updateUsersWithRoles(usersWithRoles) {
    return await this.cache.set(
      "CHANGE_ROLE",
      "users_with_roles",
      usersWithRoles,
    );
  }

  async invalidateUsersWithRoles() {
    return await this.cache.delete("CHANGE_ROLE", "users_with_roles");
  }

  /**
   * CHAT MESSAGE CACHING (Cache-Aside)
   */

  async getChatMessages(chatGroupId, limit = 50) {
    return (await this.cache.get("CHAT_MESSAGES", chatGroupId)) || [];
  }

  async cacheChatMessages(chatGroupId, messages, limit = 50) {
    const recentMessages = messages.slice(-limit);
    return await this.cache.set("CHAT_MESSAGES", chatGroupId, recentMessages);
  }

  async invalidateChatMessages(chatGroupId) {
    return await this.cache.delete("CHAT_MESSAGES", chatGroupId);
  }

  /**
   * CHAT GROUP BY USER CACHING (Cache-Aside)
   */

  async getUserChatGroups(userId) {
    const cacheKey = `user_chat_groups_${userId}`;
    return await this.cache.get("CHAT_GROUP", cacheKey);
  }

  async cacheUserChatGroups(userId, chatGroups) {
    const cacheKey = `user_chat_groups_${userId}`;
    // 5-min TTL: per-user lists change on every assignment/transfer/resolve,
    // so we use a shorter window than the 30-min default for static group data.
    return await this.cache.set("CHAT_GROUP", cacheKey, chatGroups, 300);
  }

  async invalidateUserChatGroups(userId) {
    const cacheKey = `user_chat_groups_${userId}`;
    return await this.cache.delete("CHAT_GROUP", cacheKey);
  }

  async getResolvedUserChatGroups(userId) {
    const cacheKey = `user_resolved_chat_groups_${userId}`;
    return await this.cache.get("CHAT_GROUP", cacheKey);
  }

  async cacheResolvedUserChatGroups(userId, chatGroups) {
    const cacheKey = `user_resolved_chat_groups_${userId}`;
    // 5-min TTL: same reasoning as cacheUserChatGroups — resolved list mutates often.
    return await this.cache.set("CHAT_GROUP", cacheKey, chatGroups, 300);
  }

  async invalidateResolvedUserChatGroups(userId) {
    const cacheKey = `user_resolved_chat_groups_${userId}`;
    return await this.cache.delete("CHAT_GROUP", cacheKey);
  }

  /**
   * USER PRESENCE MANAGEMENT (Redis-backed with TTL)
   * Handles 3-state agent status: accepting_chats, not_accepting_chats, offline
   */

  async setUserPresence(userId, userPresenceData) {
    return await this.cache.setUserPresence(userId, userPresenceData);
  }

  async getUserPresence(userId) {
    return await this.cache.getUserPresence(userId);
  }

  async getAllUserPresence() {
    return await this.cache.getAllUserPresence();
  }

  async removeUserPresence(userId) {
    return await this.cache.removeUserPresence(userId);
  }

  async updateUserHeartbeat(userId) {
    return await this.cache.updateUserHeartbeat(userId);
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
    return await this.cache.get("SYSTEM_CONFIG", configKey);
  }

  async setSystemConfig(configKey, configValue) {
    return await this.cache.set("SYSTEM_CONFIG", configKey, configValue);
  }

  /**
   * BULK OPERATIONS
   */

  async invalidateUserData(userId, userType = "agent") {
    const promises = [
      this.invalidateUserProfile(userId, userType),
      this.cache.deleteUserSessions(userId),
    ];

    await Promise.all(promises);
  }

  async invalidateAllDepartmentData() {
    const promises = [
      this.invalidateDepartments(),
      this.cache.delete("CANNED_MESSAGES", "*"), // Would need pattern delete
    ];

    await Promise.all(promises);
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
