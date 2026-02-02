const RoomAccess = require('./roomAccess');

/**
 * Message Authorization
 * Handles authorization for message-related operations
 */
class MessageAuth {
  constructor() {
    this.roomAccess = new RoomAccess();
    this.rateLimiters = new Map(); // Store rate limiters per user
  }

  /**
   * Authorize message sending
   */
  async authorizeSendMessage(userContext, messageData) {
    try {
      console.log(`📝 Authorizing message send for ${userContext.userType} ${userContext.userId}`);
      
      // 1. Validate message data structure
      this.validateMessageData(messageData);
      
      // 2. Check room access permissions
      const roomAccess = await this.roomAccess.canSendMessage(userContext, messageData.chat_group_id);
      if (!roomAccess.allowed) {
        throw new Error(roomAccess.reason);
      }
      
      // 3. Verify sender identity
      this.verifySenderIdentity(userContext, messageData);
      
      // 4. Check rate limits
      await this.checkRateLimit(userContext, 'sendMessage');
      
      // 5. Validate message content
      const sanitizedContent = this.validateAndSanitizeContent(messageData.chat_body);
      
      // 6. Check for spam/abuse patterns
      this.checkForAbuse(userContext, sanitizedContent);
      
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
   * Authorize message viewing/retrieval
   */
  async authorizeViewMessages(userContext, chatGroupId, messageFilters = {}) {
    try {
      console.log(`👀 Authorizing message view for ${userContext.userType} ${userContext.userId}`);
      
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
   * Check rate limits for user actions
   */
  async checkRateLimit(userContext, action) {
    const userId = `${userContext.userType}_${userContext.userId}`;
    const now = Date.now();
    
    if (!this.rateLimiters.has(userId)) {
      this.rateLimiters.set(userId, {
        messages: [],
        lastCleanup: now
      });
    }

    const userLimiter = this.rateLimiters.get(userId);
    
    // Clean up old entries (older than 1 minute)
    const oneMinuteAgo = now - 60 * 1000;
    userLimiter.messages = userLimiter.messages.filter(timestamp => timestamp > oneMinuteAgo);
    
    // Get rate limits from user permissions
    const limits = userContext.permissions?.rateLimits || {
      messagesPerMinute: 30
    };

    // Check if user has exceeded rate limit
    if (action === 'sendMessage') {
      if (userLimiter.messages.length >= limits.messagesPerMinute) {
        throw new Error(`Rate limit exceeded: maximum ${limits.messagesPerMinute} messages per minute`);
      }
      
      // Add current timestamp
      userLimiter.messages.push(now);
    }

    // Cleanup old rate limiters every 5 minutes
    if (now - userLimiter.lastCleanup > 5 * 60 * 1000) {
      this.cleanupRateLimiters();
      userLimiter.lastCleanup = now;
    }
  }

  /**
   * Check for spam and abuse patterns
   */
  checkForAbuse(userContext, content) {
    const userId = `${userContext.userType}_${userContext.userId}`;
    
    // Check for repeated identical messages
    if (!this.recentMessages) {
      this.recentMessages = new Map();
    }

    const userMessages = this.recentMessages.get(userId) || [];
    const now = Date.now();
    
    // Keep only messages from last 5 minutes
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const recentUserMessages = userMessages.filter(msg => msg.timestamp > fiveMinutesAgo);
    
    // Check for spam (same message repeated)
    const identicalCount = recentUserMessages.filter(msg => msg.content === content).length;
    if (identicalCount >= 3) {
      throw new Error('Spam detected: identical message sent too frequently');
    }

    // Check for excessive caps
    const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
    if (content.length > 20 && capsRatio > 0.7) {
      console.warn(`Excessive caps detected from user ${userId}`);
      // Don't block, just log for now
    }

    // Store message for future spam checking
    recentUserMessages.push({
      content: content,
      timestamp: now
    });
    
    this.recentMessages.set(userId, recentUserMessages);
  }

  /**
   * Apply user-specific filters for message viewing
   */
  applyUserFilters(userContext, filters) {
    const authorizedFilters = { ...filters };

    // Clients can only see their own messages and agent responses
    if (userContext.userType === 'client') {
      authorizedFilters.clientId = userContext.clientId;
    }

    // Apply department restrictions for agents if needed
    if (userContext.userType === 'agent' && !userContext.permissions?.canAccessAllDepartments) {
      // Add department-specific filters if needed
      // This would depend on your specific business logic
    }

    return authorizedFilters;
  }

  /**
   * Authorize message editing (if supported)
   */
  async authorizeEditMessage(userContext, messageId, newContent) {
    try {
      // Get original message
      const originalMessage = await this.getMessageById(messageId);
      
      if (!originalMessage) {
        throw new Error('Message not found');
      }

      // Check if user owns the message
      const isOwner = (userContext.userType === 'agent' && originalMessage.sys_user_id === userContext.userId) ||
                     (userContext.userType === 'client' && originalMessage.client_id === userContext.clientId);

      if (!isOwner) {
        throw new Error('Can only edit your own messages');
      }

      // Check if message is too old to edit (e.g., 5 minutes)
      const messageAge = Date.now() - new Date(originalMessage.chat_created_at).getTime();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (messageAge > fiveMinutes) {
        throw new Error('Message too old to edit');
      }

      // Validate new content
      const sanitizedContent = this.validateAndSanitizeContent(newContent);

      return {
        authorized: true,
        sanitizedContent: sanitizedContent,
        originalMessage: originalMessage
      };
    } catch (error) {
      throw new Error(`Message edit authorization failed: ${error.message}`);
    }
  }

  /**
   * Authorize message deletion (if supported)
   */
  async authorizeDeleteMessage(userContext, messageId) {
    try {
      const originalMessage = await this.getMessageById(messageId);
      
      if (!originalMessage) {
        throw new Error('Message not found');
      }

      // Only allow deletion by message owner or admin
      const isOwner = (userContext.userType === 'agent' && originalMessage.sys_user_id === userContext.userId) ||
                     (userContext.userType === 'client' && originalMessage.client_id === userContext.clientId);
      
      const isAdmin = userContext.permissions?.canAccessAllDepartments;

      if (!isOwner && !isAdmin) {
        throw new Error('Insufficient permissions to delete message');
      }

      return {
        authorized: true,
        originalMessage: originalMessage
      };
    } catch (error) {
      throw new Error(`Message deletion authorization failed: ${error.message}`);
    }
  }

  /**
   * Get message by ID (helper method)
   */
  async getMessageById(messageId) {
    // This would typically query your database
    // For now, return null as this is a placeholder
    console.warn('getMessageById not implemented - placeholder method');
    return null;
  }

  /**
   * Clean up old rate limiters
   */
  cleanupRateLimiters() {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    for (const [userId, limiter] of this.rateLimiters.entries()) {
      // Remove users with no recent activity
      if (limiter.messages.length === 0 || Math.max(...limiter.messages) < fiveMinutesAgo) {
        this.rateLimiters.delete(userId);
      }
    }
  }

  /**
   * Get rate limit status for a user
   */
  getRateLimitStatus(userContext) {
    const userId = `${userContext.userType}_${userContext.userId}`;
    const userLimiter = this.rateLimiters.get(userId);
    
    if (!userLimiter) {
      return {
        messagesInLastMinute: 0,
        limit: userContext.permissions?.rateLimits?.messagesPerMinute || 30,
        remaining: userContext.permissions?.rateLimits?.messagesPerMinute || 30
      };
    }

    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const recentMessages = userLimiter.messages.filter(timestamp => timestamp > oneMinuteAgo);
    const limit = userContext.permissions?.rateLimits?.messagesPerMinute || 30;

    return {
      messagesInLastMinute: recentMessages.length,
      limit: limit,
      remaining: Math.max(0, limit - recentMessages.length)
    };
  }

  /**
   * Reset rate limits for a user (admin function)
   */
  resetRateLimit(userType, userId) {
    const userKey = `${userType}_${userId}`;
    this.rateLimiters.delete(userKey);
    console.log(`Rate limit reset for user: ${userKey}`);
  }
}

module.exports = MessageAuth;