const WebSocketAuth = require('./web-socket.auth');
const MobileSocketAuth = require('./mobile-socket.auth');
const AuthUtils = require('./auth.utils');
const securityLogger = require('../security/security.logger');
const EVENTS = require('../constants/events');
const { ResponseEmitter } = require('../emitters');

/**
 * Main Socket Authentication Middleware
 * Handles authentication for both web (cookie) and mobile (JWT) clients
 */
class SocketAuthMiddleware {
  constructor() {
    this.webAuth = new WebSocketAuth();
    this.mobileAuth = new MobileSocketAuth();
    this.authUtils = new AuthUtils();
  }

  /**
   * Main authentication middleware function
   * Called during socket connection handshake
   */
  async authenticate(socket, next) {
    try {
      // 1. Detect client type (web/mobile)
      const clientType = this.detectClientType(socket);
      
      // 2. Route to appropriate auth method
      const authResult = await this.authenticateByType(socket, clientType);
      
      // 3. Validate user context and permissions
      const userContext = await this.validateUserContext(authResult);
      
      // 4. Attach authenticated user context to socket
      socket.user = userContext;
      socket.clientType = clientType;
      socket.isAuthenticated = true;
      socket.authenticatedAt = new Date();
      
      // 5. Set up session management
      this.setupSessionManagement(socket);
      
      // 6. Log successful authentication
      securityLogger.logAuthEvent('success', socket.id, userContext, {
        clientType: clientType,
        authenticatedAt: socket.authenticatedAt
      });
      
      next();
    } catch (error) {
      console.error(`❌ Socket authentication failed for ${socket.id}:`, error.message);
      
      // Log failed authentication attempt
      securityLogger.logAuthEvent('failed', socket.id, {
        ipAddress: this.getClientIP(socket),
        userAgent: socket.handshake.headers['user-agent']
      }, { 
        error: error.message,
        clientType: this.detectClientTypeForLogging(socket)
      });
      
      // Reject connection with specific error
      next(new Error(`Authentication failed: ${error.message}`));
    }
  }

  /**
   * Detect client type based on handshake headers
   */
  detectClientType(socket) {
    const headers = socket.handshake.headers;
    
    // Check for JWT in Authorization header (mobile)
    if (headers.authorization && headers.authorization.startsWith('Bearer ')) {
      return 'mobile';
    }
    
    // Check for cookies (web)
    if (headers.cookie && headers.cookie.includes('access_token')) {
      return 'web';
    }
    
    // Check user-agent for additional context
    const userAgent = headers['user-agent'] || '';
    if (userAgent.includes('Expo') || userAgent.includes('ReactNative')) {
      throw new Error('Mobile client detected but no Bearer token provided');
    }
    
    throw new Error('No valid authentication method found. Please provide either cookies (web) or Authorization header (mobile)');
  }

  /**
   * Route authentication to appropriate method based on client type
   */
  async authenticateByType(socket, clientType) {
    switch (clientType) {
      case 'web':
        return await this.webAuth.authenticate(socket);
      case 'mobile':
        return await this.mobileAuth.authenticate(socket);
      default:
        throw new Error(`Unknown client type: ${clientType}`);
    }
  }

  /**
   * Validate user context and ensure user has necessary permissions
   */
  async validateUserContext(authResult) {
    // 1. Ensure user is active
    if (authResult.userType === 'agent' && !authResult.isActive) {
      throw new Error('User account is inactive');
    }
    
    if (authResult.userType === 'client' && !authResult.isActive) {
      throw new Error('Client account is inactive');
    }
    
    // 2. Add additional context
    const userContext = {
      ...authResult,
      permissions: await this.authUtils.getUserPermissions(authResult),
      ipAddress: this.getClientIP(authResult.socket),
      userAgent: authResult.socket.handshake.headers['user-agent'],
      connectedAt: new Date()
    };
    
    return userContext;
  }

  /**
   * Set up session management for authenticated socket
   */
  setupSessionManagement(socket) {
    if (socket.clientType === 'web' && socket.user.token) {
      this.scheduleTokenValidation(socket);
    }
    
    socket.on('disconnect', (reason) => {
      this.cleanupSession(socket, reason);
    });
  }

  /**
   * Schedule periodic token validation with proactive refresh
   */
  scheduleTokenValidation(socket) {
    // Validate token every 5 minutes
    const validationInterval = setInterval(async () => {
      try {
        // Check if token is close to expiry (within 3 minutes)
        const shouldRefresh = await this.shouldRefreshToken(socket);
        
        if (shouldRefresh) {
          console.log(`🔄 Token expiring soon for socket ${socket.id}, attempting refresh...`);
          const refreshed = await this.attemptTokenRefresh(socket);
          
          if (refreshed) {
            console.log(`✅ Token refreshed successfully for socket ${socket.id}`);
            ResponseEmitter.emitTokenRefreshed(socket, 'Your session has been automatically renewed', refreshed.expires_at);
            return; // Skip validation since we just refreshed
          }
        }
        
        // Validate current token
        if (socket.clientType === 'web') {
          await this.webAuth.validateToken(socket.user.token);
        } else if (socket.clientType === 'mobile') {
          await this.mobileAuth.validateToken(socket.user.token);
        }
      } catch (error) {
        console.error(`Token validation failed for socket ${socket.id}:`, error.message);
        
        // Check if token is within grace period (2 minutes after expiry)
        const isWithinGracePeriod = this.isWithinGracePeriod(socket.user.token);
        
        if (isWithinGracePeriod) {
          console.log(`⏰ Token expired but within grace period for socket ${socket.id}`);
          ResponseEmitter.emitTokenExpiring(socket, 'Your session is expiring. Please refresh to continue.', 120);
          return; // Don't disconnect yet
        }
        
        // Grace period expired, disconnect
        ResponseEmitter.emitSessionExpired(socket, 'Token validation failed', 'Your session has expired. Please log in again.');
        socket.disconnect(true);
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    socket.tokenValidationInterval = validationInterval;
  }

  /**
   * Check if token should be refreshed (within 3 minutes of expiry)
   */
  async shouldRefreshToken(socket) {
    try {
      const token = socket.user.token;
      const payload = this.authUtils.extractJWTPayload(token);
      
      if (!payload.exp) {
        return false; // No expiration, can't determine
      }
      
      const now = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = payload.exp - now;
      const threeMinutes = 3 * 60;
      
      return timeUntilExpiry > 0 && timeUntilExpiry < threeMinutes;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if token is within grace period (2 minutes after expiry)
   */
  isWithinGracePeriod(token) {
    try {
      const payload = this.authUtils.extractJWTPayload(token);
      
      if (!payload.exp) {
        return false;
      }
      
      const now = Math.floor(Date.now() / 1000);
      const timeSinceExpiry = now - payload.exp;
      const twoMinutes = 2 * 60;
      
      // Within grace period if expired less than 2 minutes ago
      return timeSinceExpiry > 0 && timeSinceExpiry < twoMinutes;
    } catch (error) {
      return false;
    }
  }

  /**
   * Attempt to refresh token automatically
   */
  async attemptTokenRefresh(socket) {
    try {
      if (socket.clientType === 'web') {
        const refreshed = await this.webAuth.refreshTokenIfNeeded(socket);
        if (refreshed) {
          // Update socket user context with new token
          socket.user.token = refreshed.access_token;
          return refreshed;
        }
      } else if (socket.clientType === 'mobile') {
        const refreshed = await this.mobileAuth.refreshTokenIfNeeded(socket.user.token, socket.user.userId);
        if (refreshed) {
          // Update socket user context with new token
          socket.user.token = refreshed.access_token;
          // Emit new token to mobile client
          ResponseEmitter.emitNewToken(socket, refreshed.access_token, refreshed.expires_at);
          return refreshed;
        }
      }
      
      return null;
    } catch (error) {
      console.error(`Token refresh failed for socket ${socket.id}:`, error.message);
      return null;
    }
  }



  /**
   * Clean up session on disconnect
   */
  cleanupSession(socket, reason) {
    const sessionInfo = {
      socketId: socket.id,
      userId: socket.user?.userId,
      userType: socket.user?.userType,
      clientType: socket.clientType,
      sessionDuration: socket.authenticatedAt ? Date.now() - socket.authenticatedAt.getTime() : 0,
      reason: reason
    };
    
    console.log(`🧹 Cleaning up session:`, sessionInfo);
    
    // Clear token validation interval
    if (socket.tokenValidationInterval) {
      clearInterval(socket.tokenValidationInterval);
      socket.tokenValidationInterval = null;
    }
    
    // Store user info for logging before clearing
    const userForLogging = socket.user ? { ...socket.user } : {};
    
    // Clear user context and authentication state
    socket.user = null;
    socket.isAuthenticated = false;
    socket.clientType = null;
    socket.authenticatedAt = null;
    socket.chatGroupId = null;
    
    // Log disconnection
    securityLogger.logAuthEvent('disconnect', socket.id, userForLogging, { 
      reason,
      sessionDuration: sessionInfo.sessionDuration
    });
  }

  /**
   * Get client IP address
   */
  getClientIP(socket) {
    return socket.handshake.address || 
           socket.handshake.headers['x-forwarded-for'] || 
           socket.handshake.headers['x-real-ip'] || 
           'unknown';
  }

  /**
   * Detect client type for logging (safe version that doesn't throw)
   */
  detectClientTypeForLogging(socket) {
    try {
      return this.detectClientType(socket);
    } catch (error) {
      return 'unknown';
    }
  }
}

module.exports = SocketAuthMiddleware;