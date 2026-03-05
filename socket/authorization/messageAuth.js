const RoomAccess = require('./roomAccess');
const cacheService = require('../../services/cache.service');

/**
 * Message Authorization - Now uses centralized Redis cache
 * Handles authorization for message-related operations
 */
class MessageAuth {
  constructor() {
    this.roomAccess = new RoomAccess();
    // Using centralized cache manager now
  }

  /**
   * Authorize message sending
   */
  async authorizeSendMessage(userContext, messageData) {
    try {
      // 1. Validate message data structure
      this.validateMessageData(messageData);
      
      // 2. Check room access permissions
      const roomAccess = await this.roomAccess.canSendMessage(userContext, messageData.chat_group_id);
      if (!roomAccess.allowed) {
        throw new Error(roomAccess.reason);
      }
      
      // 3. Verify sender identity
      this.verifySenderIdentity(userContext, messageData);
      
      // 4. Check rate limits using Redis
      await this.checkRateLimit(userContext, 'sendMessage');
      
      // 5. Validate message content
      const sanitizedContent = this.validateAndSanitizeContent(messageData.chat_body);
      
      // 6. Check for spam/abuse patterns using Redis
      await this.checkForAbuse(userContext, sanitizedContent);
      
      return {
        authorized: true,
        sanitizedMessage: {
          ...messageData,
          chat_body: sanitizedContent
        },
        roomInfo: roomAccess.roomInfo
      };
    } catch (error) {
      console.error(`❌ Message authorization failed:`, error.message);
      throw new Error(`Message authorization failed: ${error.message}`);
    }
  }

  /**
   * Check rate limits using Redis
   */
  async checkRateLimit(userContext, action) {
    try {
      const userId = `${userContext.userType}_${userContext.userId}`;
      const rateLimitKey = `${action}_${userId}`;
      
      // Get rate limits from user permissions
      const limits = userContext.permissions?.rateLimits || {
        messagesPerMinute: 30
      };
      
      const limit = action === 'sendMessage' ? limits.messagesPerMinute : 30;
      const allowed = await cacheService.checkRateLimit(rateLimitKey, limit, 60);
      
      if (!allowed) {
        throw new Error(`Rate limit exceeded: maximum ${limit} ${action} per minute`);
      }
    } catch (error) {
      if (error.message.includes('Rate limit exceeded')) {
        throw error;
      }
      console.error('❌ Error checking rate limit:', error.message);
      // Allow on error to prevent blocking legitimate users
    }
  }

  /**
   * Check for spam and abuse patterns using Redis
   */
  async checkForAbuse(userContext, content) {
    try {
      const userId = `${userContext.userType}_${userContext.userId}`;
      const abuseKey = `abuse_check_${userId}`;
      
      // Get recent messages for this user
      let recentMessages = await cacheService.cache.get('RATE_LIMIT', abuseKey) || [];
      
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;
      
      // Keep only messages from last 5 minutes
      recentMessages = recentMessages.filter(msg => msg.timestamp > fiveMinutesAgo);
      
      // Check for spam (same message repeated)
      const identicalCount = recentMessages.filter(msg => msg.content === content).length;
      if (identicalCount >= 3) {
        throw new Error('Spam detected: identical message sent too frequently');
      }

      // Check for excessive caps
      const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
      if (content.length > 20 && capsRatio > 0.7) {
        // Don't block, just log for now
      }

      // Store message for future spam checking
      recentMessages.push({
        content: content,
        timestamp: now
      });
      
      // Cache for 5 minutes
      await cacheService.cache.set('RATE_LIMIT', abuseKey, recentMessages, 300);
    } catch (error) {
      if (error.message.includes('Spam detected')) {
        throw error;
      }
      console.error('❌ Error checking for abuse:', error.message);
      // Allow on error
    }
  }

  /**
   * Authorize message viewing/retrieval
   */
  async authorizeViewMessages(userContext, chatGroupId, messageFilters = {}) {
    try {
      // Check room access permissions
      const roomAccess = await this.roomAccess.canViewMessages(userContext, chatGroupId);
      if (!roomAccess.allowed) {
        throw new Error(roomAccess.reason);
      }

      // Apply user-specific message filters
      const authorizedFilters = this.applyUserFilters(userContext, messageFilters);

      return {
        authorized: true,
        roomInfo: roomAccess.roomInfo,
        filters: authorizedFilters
      };
    } catch (error) {
      throw new Error(`Message view authorization failed: ${error.message}`);
    }
  }

  /**
   * Validate message data structure
   */
  validateMessageData(messageData) {
    if (!messageData) {
      throw new Error('Message data is required');
    }

    if (!messageData.chat_group_id) {
      throw new Error('Chat group ID is required');
    }

    if (!messageData.chat_body || typeof messageData.chat_body !== 'string') {
      throw new Error('Message body is required and must be a string');
    }

    // Check for required sender identification
    const hasAgentId = messageData.sys_user_id;
    const hasClientId = messageData.client_id;
    
    if (!hasAgentId && !hasClientId) {
      throw new Error('Message must have either sys_user_id or client_id');
    }

    if (hasAgentId && hasClientId) {
      throw new Error('Message cannot have both sys_user_id and client_id');
    }
  }

  /**
   * Verify sender identity matches authenticated user
   */
  verifySenderIdentity(userContext, messageData) {
    if (userContext.userType === 'agent') {
      if (!messageData.sys_user_id || messageData.sys_user_id !== userContext.userId) {
        throw new Error('Agent sender ID does not match authenticated user');
      }
      if (messageData.client_id) {
        throw new Error('Agent cannot send messages with client_id');
      }
    } else if (userContext.userType === 'client') {
      if (!messageData.client_id || messageData.client_id !== userContext.clientId) {
        throw new Error('Client sender ID does not match authenticated user');
      }
      if (messageData.sys_user_id) {
        throw new Error('Client cannot send messages with sys_user_id');
      }
    }
  }

  /**
   * Validate and sanitize message content
   */
  validateAndSanitizeContent(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('Message content must be a non-empty string');
    }

    const trimmedContent = content.trim();
    
    if (trimmedContent.length === 0) {
      throw new Error('Message content cannot be empty');
    }

    if (trimmedContent.length > 5000) {
      throw new Error('Message content too long (max 5000 characters)');
    }

    // Basic sanitization - remove potentially dangerous content
    let sanitized = trimmedContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '') // Remove iframe tags
      .replace(/javascript:/gi, '') // Remove javascript: URLs
      .replace(/on\w+\s*=/gi, ''); // Remove event handlers

    // Limit consecutive newlines
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

    return sanitized;
  }

  /**
   * Check rate limits for user actions (legacy method for compatibility)
   */
  async checkRateLimitLegacy(userContext, action) {
    // Redirect to new Redis-based rate limiting
    return await this.checkRateLimit(userContext, action);
  }

  /**
   * Check for spam and abuse patterns (legacy method for compatibility)
   */
  async checkForAbuseLegacy(userContext, content) {
    // Redirect to new Redis-based abuse checking
    return await this.checkForAbuse(userContext, content);
  }

  /**
   * Clean up old rate limiters (now handled by Redis TTL)
   */
  cleanupRateLimiters() {
    // Rate limiters are automatically cleaned up by Redis TTL
    console.log('🧹 Rate limiters cleaned up automatically by Redis TTL');
  }

  /**
   * Get rate limit status for a user using Redis
   */
  async getRateLimitStatus(userContext) {
    try {
      const userId = `${userContext.userType}_${userContext.userId}`;
      const rateLimitKey = `sendMessage_${userId}`;
      
      // This is a simplified version - Redis doesn't easily provide current count
      // In a production system, you might want to implement a more sophisticated tracking
      const limits = userContext.permissions?.rateLimits || {
        messagesPerMinute: 30
      };

      return {
        messagesInLastMinute: 'N/A', // Would need additional tracking to provide exact count
        limit: limits.messagesPerMinute,
        remaining: 'N/A' // Would need additional tracking
      };
    } catch (error) {
      console.error('❌ Error getting rate limit status:', error.message);
      return {
        messagesInLastMinute: 0,
        limit: 30,
        remaining: 30
      };
    }
  }

  /**
   * Reset rate limits for a user using Redis
   */
  async resetRateLimit(userType, userId) {
    try {
      const rateLimitKey = `sendMessage_${userType}_${userId}`;
      await cacheService.cache.delete('RATE_LIMIT', rateLimitKey);
      console.log(`🔄 Reset rate limit for ${userType} ${userId}`);
    } catch (error) {
      console.error('❌ Error resetting rate limit:', error.message);
    }
  }
}

module.exports = MessageAuth;