/**
 * Security Logger
 * Handles security event logging and monitoring
 */
class SecurityLogger {
  constructor() {
    this.logLevel = process.env.SECURITY_LOG_LEVEL || 'INFO';
    this.enableConsoleLogging = process.env.NODE_ENV !== 'production';
    this.securityEvents = new Map(); // In-memory storage for recent events
    this.maxEvents = 1000; // Maximum events to keep in memory
  }

  /**
   * Log security event
   */
  logSecurityEvent(eventType, details = {}) {
    const logEntry = {
      id: this.generateEventId(),
      timestamp: new Date().toISOString(),
      eventType,
      level: this.getEventLevel(eventType),
      details,
      source: 'socket-security'
    };

    // Store in memory
    this.storeEvent(logEntry);

    // Console logging for development
    if (this.enableConsoleLogging) {
      this.logToConsole(logEntry);
    }

    // TODO: Implement database logging
    // await this.logToDatabase(logEntry);

    // TODO: Implement alert system for critical events
    if (logEntry.level === 'CRITICAL') {
      this.triggerAlert(logEntry);
    }

    return logEntry.id;
  }

  /**
   * Log authentication events
   */
  logAuthEvent(eventType, socketId, userContext = {}, details = {}) {
    return this.logSecurityEvent('auth_' + eventType, {
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
  logAuthzEvent(eventType, socketId, userContext = {}, resource = '', details = {}) {
    return this.logSecurityEvent('authz_' + eventType, {
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
  logRateLimitEvent(socketId, userContext = {}, action = '', details = {}) {
    return this.logSecurityEvent('rate_limit_exceeded', {
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
  logAbuseEvent(eventType, socketId, userContext = {}, details = {}) {
    return this.logSecurityEvent('abuse_' + eventType, {
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
   * Store event in memory
   */
  storeEvent(logEntry) {
    // Remove oldest events if we exceed max capacity
    if (this.securityEvents.size >= this.maxEvents) {
      const oldestKey = this.securityEvents.keys().next().value;
      this.securityEvents.delete(oldestKey);
    }

    this.securityEvents.set(logEntry.id, logEntry);
  }

  /**
   * Log to console with formatting
   */
  logToConsole(logEntry) {
    const emoji = this.getEventEmoji(logEntry.level);
    const timestamp = new Date(logEntry.timestamp).toLocaleTimeString();
    
    console.log(`${emoji} [${timestamp}] SECURITY [${logEntry.level}] ${logEntry.eventType}`);
    
    if (logEntry.details && Object.keys(logEntry.details).length > 0) {
      console.log('   Details:', JSON.stringify(logEntry.details, null, 2));
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

  /**
   * Get recent security events
   */
  getRecentEvents(limit = 50, level = null) {
    const events = Array.from(this.securityEvents.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (level) {
      return events.filter(event => event.level === level).slice(0, limit);
    }

    return events.slice(0, limit);
  }

  /**
   * Get security statistics
   */
  getSecurityStats(timeRange = 3600000) { // Default: last hour
    const now = Date.now();
    const cutoff = now - timeRange;
    
    const recentEvents = Array.from(this.securityEvents.values())
      .filter(event => new Date(event.timestamp).getTime() > cutoff);

    const stats = {
      totalEvents: recentEvents.length,
      byLevel: {},
      byType: {},
      timeRange: timeRange / 1000 / 60, // Convert to minutes
      generatedAt: new Date().toISOString()
    };

    // Count by level
    recentEvents.forEach(event => {
      stats.byLevel[event.level] = (stats.byLevel[event.level] || 0) + 1;
      stats.byType[event.eventType] = (stats.byType[event.eventType] || 0) + 1;
    });

    return stats;
  }

  /**
   * Check for suspicious patterns
   */
  detectSuspiciousActivity(userId, timeWindow = 300000) { // 5 minutes
    const now = Date.now();
    const cutoff = now - timeWindow;
    
    const userEvents = Array.from(this.securityEvents.values())
      .filter(event => 
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
  triggerAlert(logEntry) {
    console.error(`🚨 CRITICAL SECURITY ALERT: ${logEntry.eventType}`);
    console.error('Details:', JSON.stringify(logEntry.details, null, 2));
    
    // TODO: Implement actual alerting (email, Slack, etc.)
    // await this.sendAlert(logEntry);
  }

  /**
   * Clear old events (cleanup)
   */
  cleanup(maxAge = 86400000) { // 24 hours
    const cutoff = Date.now() - maxAge;
    
    for (const [id, event] of this.securityEvents.entries()) {
      if (new Date(event.timestamp).getTime() < cutoff) {
        this.securityEvents.delete(id);
      }
    }
  }

  /**
   * Export security logs (for analysis)
   */
  exportLogs(format = 'json', timeRange = null) {
    let events = Array.from(this.securityEvents.values());
    
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
}

// Singleton instance
const securityLogger = new SecurityLogger();

module.exports = securityLogger;