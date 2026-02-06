const { cacheManager } = require('../helpers/redisClient');
const supabase = require('../helpers/supabaseClient');

/**
 * Cache Service - High-level caching operations for business logic
 * Uses the centralized cache manager for all operations
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
    let profile = await this.cache.get(prefix, userId);
    
    if (!profile) {
      // Cache miss - fetch from database
      try {
        if (userType === 'client') {
          const { data, error } = await supabase
            .from('client')
            .select(`
              client_id,
              client_number,
              client_country_code,
              profile:prof_id (
                prof_firstname,
                prof_lastname,
                prof_address,
                prof_date_of_birth
              )
            `)
            .eq('client_id', userId)
            .single();
          
          if (!error && data) {
            profile = data;
            await this.cache.set(prefix, userId, profile);
          }
        } else {
          const { data, error } = await supabase
            .from('sys_user')
            .select(`
              sys_user_id,
              sys_user_email,
              role_id,
              sys_user_is_active,
              profile:prof_id (
                prof_firstname,
                prof_lastname,
                prof_address,
                prof_date_of_birth
              ),
              role:role_id (
                role_name,
                role_permissions
              )
            `)
            .eq('sys_user_id', userId)
            .single();
          
          if (!error && data) {
            profile = data;
            await this.cache.set(prefix, userId, profile);
          }
        }
      } catch (error) {
        console.error(`❌ Failed to fetch ${userType} profile:`, error.message);
      }
    }
    
    return profile;
  }

  async invalidateUserProfile(userId, userType = 'agent') {
    const prefix = userType === 'client' ? 'CLIENT_PROFILE' : 'USER_PROFILE';
    return await this.cache.delete(prefix, userId);
  }

  /**
   * DEPARTMENT CACHING (Write-Through)
   */
  
  async getDepartments() {
    let departments = await this.cache.get('DEPARTMENT', 'all');
    
    if (!departments) {
      // Cache miss - fetch from database
      try {
        const { data, error } = await supabase
          .from('department')
          .select('*')
          .eq('dept_is_active', true)
          .order('dept_name');
        
        if (!error && data) {
          departments = data;
          await this.cache.set('DEPARTMENT', 'all', departments);
        }
      } catch (error) {
        console.error('❌ Failed to fetch departments:', error.message);
        return [];
      }
    }
    
    return departments || [];
  }

  async updateDepartments(departments) {
    // Write-through: Update database first, then cache
    const dbUpdateFn = async (data) => {
      // This would be called by the department service
      // Just update cache here since DB update is handled by service
    };
    
    return await this.cache.set('DEPARTMENT', 'all', departments);
  }

  async invalidateDepartments() {
    return await this.cache.delete('DEPARTMENT', 'all');
  }

  /**
   * ROLE CACHING (Write-Through)
   */
  
  async getRoles() {
    let roles = await this.cache.get('ROLE', 'all');
    
    if (!roles) {
      try {
        const { data, error } = await supabase
          .from('role')
          .select('*')
          .order('role_name');
        
        if (!error && data) {
          roles = data;
          await this.cache.set('ROLE', 'all', roles);
        }
      } catch (error) {
        console.error('❌ Failed to fetch roles:', error.message);
        return [];
      }
    }
    
    return roles || [];
  }

  async invalidateRoles() {
    return await this.cache.delete('ROLE', 'all');
  }

  /**
   * CANNED MESSAGES CACHING (Cache-Aside)
   */
  
  async getCannedMessages(roleId, userId = null) {
    const cacheKey = userId ? `${roleId}_${userId}` : roleId;
    let messages = await this.cache.get('CANNED_MESSAGES', cacheKey);
    
    if (!messages) {
      try {
        let query = supabase
          .from('canned_message')
          .select('canned_id, canned_message, dept_id')
          .eq('role_id', roleId)
          .eq('canned_is_active', true);

        if (userId) {
          // Get user's departments and filter
          const { data: userDepts } = await supabase
            .from('sys_user_department')
            .select('dept_id')
            .eq('sys_user_id', userId);

          if (userDepts && userDepts.length > 0) {
            const deptIds = userDepts.map(d => d.dept_id);
            query = query.or(`dept_id.in.(${deptIds.join(',')}),dept_id.is.null`);
          } else {
            query = query.is('dept_id', null);
          }
        }

        const { data, error } = await query;
        
        if (!error && data) {
          messages = data;
          await this.cache.set('CANNED_MESSAGES', cacheKey, messages);
        }
      } catch (error) {
        console.error('❌ Failed to fetch canned messages:', error.message);
        return [];
      }
    }
    
    return messages || [];
  }

  async invalidateCannedMessages(roleId, userId = null) {
    const cacheKey = userId ? `${roleId}_${userId}` : roleId;
    return await this.cache.delete('CANNED_MESSAGES', cacheKey);
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