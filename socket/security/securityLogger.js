const cacheService = require('../../services/cache.service');

/**
 * Security Logger - Now uses centralized Redis cache
 * Handles security event logging and monitoring
 */
class SecurityLogger {
  constructor() {
    this.logLevel = process.env.SECURITY_LOG_LEVEL || 'INFO';
    this.enableConsoleLogging = process.env.NODE_ENV !== 'production';
    this.maxEvents = 1000; // Maximum events to keep in memory
  }

  /**
   * Log security event using Redis
   */
  async logSecurityEvent(eventType, details = {}) {
    try {
      const logEntry = {
        id: this.generateEventId(),
        timestamp: new Date().toISOString(),
        eventType,
        level: this.getEventLevel(eventType),
        details,
        source: 'socket-security'
      };

      // Store individual event in Redis with TTL
      const eventKey = `security_event_${logEntry.id}`;
      await cacheService.cache.set('SYSTEM_CONFIG', eventKey, logEntry, 24 * 60 * 60); // 24 hours

      // Add to recent events list
      await this.addToRecentEvents(logEntry);

      // Console logging for development
      if (this.enableConsoleLogging) {
        this.logToConsole(logEntry);
      }

      // TODO: Implement database logging
      // await this.logToDatabase(logEntry);

      // TODO: Implement alert system for critical events
      if (logEntry.level === 'CRITICAL') {
        await this.triggerAlert(logEntry);
      }

      return logEntry.id;
    } catch (error) {
      console.error('❌ Error logging security event:', error.message);
      // Fallback to console logging
      this.logToConsole({ eventType, level: 'ERROR', details, timestamp: new Date().toISOString() });
    }
  }

  /**
   * Add event to recent events list in Redis
   */
  async addToRecentEvents(logEntry) {
    try {
      const recentEventsKey = 'recent_security_events';
      let recentEvents = await cacheService.cache.get('SYSTEM_CONFIG', recentEventsKey) || [];
      
      // Add new event to the beginning
      recentEvents.unshift(logEntry);
      
      // Keep only the most recent events
      if (recentEvents.length > this.maxEvents) {
        recentEvents = recentEvents.slice(0, this.maxEvents);
      }
      
      // Store back with 24 hour TTL
      await cacheService.cache.set('SYSTEM_CONFIG', recentEventsKey, recentEvents, 24 * 60 * 60);
    } catch (error) {
      console.error('❌ Error adding to recent events:', error.message);
    }
  }

  /**
   * Log authentication events
   */
  async logAuthEvent(eventType, socketId, userContext = {}, details = {}) {
    return await this.logSecurityEvent('auth_' + eventType, {
      socketId,
      userId: userContext.userId || 'unknown',
      userType: userContext.userType || 'unknown',
      clientType: userContext.clientType || 'unknown',
      ipAddress: userContext.ipAddress || 'unknown',
      userAgent: userContext.userAgent || 'unknown',
      ...details
    });
  }

  /**
   * Log authorization events
   */
  async logAuthzEvent(eventType, socketId, userContext = {}, resource = '', details = {}) {
    return await this.logSecurityEvent('authz_' + eventType, {
      socketId,
      userId: userContext.userId || 'unknown',
      userType: userContext.userType || 'unknown',
      resource,
      ...details
    });
  }

  /**
   * Log rate limiting events
   */
  async logRateLimitEvent(socketId, userContext = {}, action = '', details = {}) {
    return await this.logSecurityEvent('rate_limit_exceeded', {
      socketId,
      userId: userContext.userId || 'unknown',
      userType: userContext.userType || 'unknown',
      action,
      ...details
    });
  }

  /**
   * Log abuse detection events
   */
  async logAbuseEvent(eventType, socketId, userContext = {}, details = {}) {
    return await this.logSecurityEvent('abuse_' + eventType, {
      socketId,
      userId: userContext.userId || 'unknown',
      userType: userContext.userType || 'unknown',
      ...details
    });
  }

  /**
   * Get event severity level
   */
  getEventLevel(eventType) {
    const criticalEvents = [
      'auth_failed_multiple',
      'abuse_detected',
      'token_spoofing',
      'unauthorized_access_attempt'
    ];

    const warningEvents = [
      'auth_failed',
      'authz_denied',
      'rate_limit_exceeded',
      'suspicious_activity'
    ];

    if (criticalEvents.includes(eventType)) {
      return 'CRITICAL';
    } else if (warningEvents.includes(eventType)) {
      return 'WARNING';
    } else {
      return 'INFO';
    }
  }

  /**
   * Get recent security events from Redis
   */
  async getRecentEvents(limit = 50, level = null) {
    try {
      const recentEventsKey = 'recent_security_events';
      const events = await cacheService.cache.get('SYSTEM_CONFIG', recentEventsKey) || [];
      
      let filteredEvents = events;
      if (level) {
        filteredEvents = events.filter(event => event.level === level);
      }
      
      return filteredEvents.slice(0, limit);
    } catch (error) {
      console.error('❌ Error getting recent events:', error.message);
      return [];
    }
  }

  /**
   * Get security statistics from Redis
   */
  async getSecurityStats(timeRange = 3600000) { // Default: last hour
    try {
      const now = Date.now();
      const cutoff = now - timeRange;
      
      const recentEvents = await this.getRecentEvents(1000); // Get more events for stats
      const filteredEvents = recentEvents.filter(event => 
        new Date(event.timestamp).getTime() > cutoff
      );

      const stats = {
        totalEvents: filteredEvents.length,
        byLevel: {},
        byType: {},
        timeRange: timeRange / 1000 / 60, // Convert to minutes
        generatedAt: new Date().toISOString()
      };

      // Count by level and type
      filteredEvents.forEach(event => {
        stats.byLevel[event.level] = (stats.byLevel[event.level] || 0) + 1;
        stats.byType[event.eventType] = (stats.byType[event.eventType] || 0) + 1;
      });

      return stats;
    } catch (error) {
      console.error('❌ Error getting security stats:', error.message);
      return {
        totalEvents: 0,
        byLevel: {},
        byType: {},
        timeRange: timeRange / 1000 / 60,
        generatedAt: new Date().toISOString(),
        error: 'Failed to retrieve stats'
      };
    }
  }

  /**
   * Check for suspicious patterns using Redis
   */
  async detectSuspiciousActivity(userId, timeWindow = 300000) { // 5 minutes
    try {
      const now = Date.now();
      const cutoff = now - timeWindow;
      
      const recentEvents = await this.getRecentEvents(500); // Get enough events for analysis
      const userEvents = recentEvents.filter(event => 
        event.details.userId === userId && 
        new Date(event.timestamp).getTime() > cutoff
      );

      const suspiciousPatterns = {
        multipleFailedAuth: 0,
        rateLimitExceeded: 0,
        accessDenied: 0,
        total: userEvents.length
      };

      userEvents.forEach(event => {
        if (event.eventType.includes('auth_failed')) {
          suspiciousPatterns.multipleFailedAuth++;
        }
        if (event.eventType.includes('rate_limit')) {
          suspiciousPatterns.rateLimitExceeded++;
        }
        if (event.eventType.includes('authz_denied')) {
          suspiciousPatterns.accessDenied++;
        }
      });

      // Determine if activity is suspicious
      const isSuspicious = 
        suspiciousPatterns.multipleFailedAuth >= 3 ||
        suspiciousPatterns.rateLimitExceeded >= 2 ||
        suspiciousPatterns.accessDenied >= 5 ||
        suspiciousPatterns.total >= 20;

      return {
        isSuspicious,
        patterns: suspiciousPatterns,
        riskLevel: this.calculateRiskLevel(suspiciousPatterns)
      };
    } catch (error) {
      console.error('❌ Error detecting suspicious activity:', error.message);
      return {
        isSuspicious: false,
        patterns: { multipleFailedAuth: 0, rateLimitExceeded: 0, accessDenied: 0, total: 0 },
        riskLevel: 'UNKNOWN'
      };
    }
  }

  /**
   * Calculate risk level based on patterns
   */
  calculateRiskLevel(patterns) {
    let score = 0;
    
    score += patterns.multipleFailedAuth * 3;
    score += patterns.rateLimitExceeded * 2;
    score += patterns.accessDenied * 1;
    score += Math.floor(patterns.total / 10);

    if (score >= 10) return 'HIGH';
    if (score >= 5) return 'MEDIUM';
    if (score >= 2) return 'LOW';
    return 'MINIMAL';
  }

  /**
   * Trigger alert for critical events
   */
  async triggerAlert(logEntry) {
    try {
      console.error(`🚨 CRITICAL SECURITY ALERT: ${logEntry.eventType}`);
      console.error('Details:', JSON.stringify(logEntry.details, null, 2));
      
      // Store alert in Redis for tracking
      const alertKey = `security_alert_${logEntry.id}`;
      await cacheService.cache.set('SYSTEM_CONFIG', alertKey, {
        ...logEntry,
        alertTriggered: true,
        alertTime: new Date().toISOString()
      }, 7 * 24 * 60 * 60); // Keep alerts for 7 days
      
      // TODO: Implement actual alerting (email, Slack, etc.)
      // await this.sendAlert(logEntry);
    } catch (error) {
      console.error('❌ Error triggering alert:', error.message);
    }
  }

  /**
   * Clear old events (cleanup) - now handled by Redis TTL
   */
  async cleanup(maxAge = 86400000) { // 24 hours
    try {
      // Events are automatically cleaned up by Redis TTL
      console.log('🧹 Security events cleaned up automatically by Redis TTL');
      
      // Optional: Clean up the recent events list if needed
      const recentEvents = await this.getRecentEvents(this.maxEvents * 2);
      const cutoff = Date.now() - maxAge;
      const validEvents = recentEvents.filter(event => 
        new Date(event.timestamp).getTime() > cutoff
      );
      
      if (validEvents.length < recentEvents.length) {
        const recentEventsKey = 'recent_security_events';
        await cacheService.cache.set('SYSTEM_CONFIG', recentEventsKey, validEvents, 24 * 60 * 60);
        console.log(`🧹 Cleaned up ${recentEvents.length - validEvents.length} old security events`);
      }
    } catch (error) {
      console.error('❌ Error during cleanup:', error.message);
    }
  }

  /**
   * Export security logs from Redis
   */
  async exportLogs(format = 'json', timeRange = null) {
    try {
      let events = await this.getRecentEvents(this.maxEvents * 2);
      
      if (timeRange) {
        const cutoff = Date.now() - timeRange;
        events = events.filter(event => 
          new Date(event.timestamp).getTime() > cutoff
        );
      }

      events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      if (format === 'csv') {
        return this.convertToCSV(events);
      }

      return JSON.stringify(events, null, 2);
    } catch (error) {
      console.error('❌ Error exporting logs:', error.message);
      return format === 'csv' ? '' : '[]';
    }
  }

  /**
   * Convert events to CSV format
   */
  convertToCSV(events) {
    if (events.length === 0) return '';

    const headers = ['timestamp', 'eventType', 'level', 'userId', 'userType', 'socketId'];
    const csvRows = [headers.join(',')];

    events.forEach(event => {
      const row = [
        event.timestamp,
        event.eventType,
        event.level,
        event.details.userId || '',
        event.details.userType || '',
        event.details.socketId || ''
      ];
      csvRows.push(row.join(','));
    });

    return csvRows.join('\n');
  }

  /**
   * Log to console with formatting
   */
  logToConsole(logEntry) {
    const emoji = this.getEventEmoji(logEntry.level);
    const timestamp = new Date(logEntry.timestamp).toLocaleTimeString();
    
    // console.log(`${emoji} [${timestamp}] ${logEntry.eventType} (${logEntry.level})`);
    if (logEntry.details && Object.keys(logEntry.details).length > 0) {
      // console.log('Details:', JSON.stringify(logEntry.details, null, 2));
    }
  }

  /**
   * Get emoji for log level
   */
  getEventEmoji(level) {
    switch (level) {
      case 'CRITICAL': return '🚨';
      case 'WARNING': return '⚠️';
      case 'INFO': return '🔒'; 
      default: return '📝';
    }
  }

  /**
   * Generate unique event ID
   */
  generateEventId() {
    return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
const securityLogger = new SecurityLogger();

module.exports = securityLogger;