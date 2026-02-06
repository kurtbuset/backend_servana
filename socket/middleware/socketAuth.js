const WebSocketAuth = require('./webSocketAuth');
const MobileSocketAuth = require('./mobileSocketAuth');
const AuthUtils = require('./authUtils');
const securityLogger = require('../security/securityLogger');

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
    // 1. Set up token refresh timer for web clients
    if (socket.clientType === 'web' && socket.user.token) {
      this.scheduleTokenValidation(socket);
    }
    
    // 2. Set up heartbeat monitoring
    this.setupHeartbeat(socket);
    
    // 3. Handle disconnection cleanup
    socket.on('disconnect', (reason) => {
      this.cleanupSession(socket, reason);
    });
  }

  /**
   * Schedule periodic token validation
   */
  scheduleTokenValidation(socket) {
    // Validate token every 5 minutes
    const validationInterval = setInterval(async () => {
      try {
        if (socket.clientType === 'web') {
          await this.webAuth.validateToken(socket.user.token);
        } else if (socket.clientType === 'mobile') {
          await this.mobileAuth.validateToken(socket.user.token);
        }
      } catch (error) {
        console.error(`Token validation failed for socket ${socket.id}:`, error.message);
        socket.emit('session_expired', { reason: 'Token validation failed' });
        socket.disconnect(true);
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    socket.tokenValidationInterval = validationInterval;
  }

  /**
   * Set up heartbeat monitoring
   */
  setupHeartbeat(socket) {
    socket.lastHeartbeat = new Date();
    
    socket.on('heartbeat', () => {
      socket.lastHeartbeat = new Date();
    });
    
    // Check for stale connections every 2 minutes
    const heartbeatCheck = setInterval(() => {
      const now = new Date();
      const timeSinceLastHeartbeat = now - socket.lastHeartbeat;
      
      // Disconnect if no heartbeat for 10 minutes
      if (timeSinceLastHeartbeat > 10 * 60 * 1000) {
        socket.disconnect(true);
      }
    }, 2 * 60 * 1000); // Check every 2 minutes
    
    socket.heartbeatInterval = heartbeatCheck;
  }

  /**
   * Clean up session on disconnect
   */
  cleanupSession(socket, reason) {
    // Clear intervals
    if (socket.tokenValidationInterval) {
      clearInterval(socket.tokenValidationInterval);
    }
    
    if (socket.heartbeatInterval) {
      clearInterval(socket.heartbeatInterval);
    }
    
    // Clear user context and authentication state
    socket.user = null;
    socket.isAuthenticated = false;
    socket.clientType = null;
    socket.authenticatedAt = null;
    socket.chatGroupId = null;
    
    // Log disconnection
    securityLogger.logAuthEvent('disconnect', socket.id, socket.user || {}, { reason });
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