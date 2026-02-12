const supabase = require('../../helpers/supabaseClient');
const AuthUtils = require('./authUtils');
const jwtUtils = require('../../src/utils/jwt');

/**
 * Mobile Socket Authentication
 * Handles authentication for mobile clients using JWT tokens
 */
class MobileSocketAuth {
  constructor() {
    this.authUtils = new AuthUtils();
  }

  /**
   * Authenticate mobile client using JWT Bearer token
   */
  async authenticate(socket) {
    try {
      // 1. Extract JWT token from Authorization header
      const token = this.extractBearerToken(socket);
      
      // 2. Validate token format
      this.authUtils.validateTokenFormat(token, 'jwt');
      
      // 3. Verify and decode JWT
      const decodedToken = await this.verifyJWT(token);
      
      // 4. Get client data from database
      const clientData = await this.getClientData(decodedToken.client_id);
      
      // 5. Return authenticated user context
      return {
        userId: clientData.client_id,
        userType: 'client',
        clientId: clientData.client_id,
        profId: clientData.prof_id,
        firstName: clientData.profile?.prof_firstname,
        lastName: clientData.profile?.prof_lastname,
        countryCode: clientData.client_country_code,
        phoneNumber: clientData.client_number,
        isActive: clientData.client_is_active,
        token: token,
        socket: socket
      };
    } catch (error) {
      throw new Error(`Mobile authentication failed: ${error.message}`);
    }
  }

  /**
   * Extract Bearer token from Authorization header
   */
  extractBearerToken(socket) {
    const authHeader = socket.handshake.headers.authorization;
    
    if (!authHeader) {
      throw new Error('No Authorization header found');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new Error('Invalid Authorization header format. Expected: Bearer <token>');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    if (!token) {
      throw new Error('No token found in Authorization header');
    }

    return token;
  }

  /**
   * Verify and decode JWT token
   */
  async verifyJWT(token) {
    try {
      // First check if token is expired (quick check)
      if (this.authUtils.isTokenExpired(token)) {
        throw new Error('Token has expired');
      }

      // Verify JWT signature and decode using utility
      const decoded = jwtUtils.verifyAccessToken(token);
      
      if (!decoded.client_id) {
        throw new Error('Invalid token: missing client_id');
      }

      // Check token expiration again (JWT verify should catch this, but double-check)
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp && decoded.exp < now) {
        throw new Error('Token has expired');
      }

      return decoded;
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token signature');
      } else if (error.name === 'TokenExpiredError') {
        throw new Error('Token has expired');
      } else if (error.name === 'NotBeforeError') {
        throw new Error('Token not active yet');
      }
      
      throw error;
    }
  }

  /**
   * Get client data from database
   */
  async getClientData(clientId) {
    try {
      const { data: clientData, error } = await supabase
        .from('client')
        .select(`
          client_id,
          client_country_code,
          client_number,
          client_is_active,
          client_created_at,
          prof_id,
          profile:prof_id (
            prof_firstname,
            prof_lastname
          )
        `)
        .eq('client_id', clientId)
        .single();

      if (error) {
        throw new Error('Failed to fetch client data');
      }

      if (!clientData) {
        throw new Error('Client not found');
      }

      if (!clientData.client_is_active) {
        throw new Error('Client account is inactive');
      }

      return clientData;
    } catch (error) {
      if (error.message.includes('Client not found') || error.message.includes('inactive')) {
        throw error;
      }
      throw new Error('Database error: ' + error.message);
    }
  }

  /**
   * Validate token (for periodic checks)
   */
  async validateToken(token) {
    try {
      // Check if token is expired first (faster check)
      if (this.authUtils.isTokenExpired(token)) {
        throw new Error('Token has expired');
      }

      // Verify JWT
      const decoded = jwt.verify(token, this.jwtSecret);
      
      if (!decoded.client_id) {
        throw new Error('Invalid token structure');
      }

      // Verify client still exists and is active
      const clientData = await this.getClientData(decoded.client_id);
      
      if (!clientData.client_is_active) {
        throw new Error('Client account has been deactivated');
      }

      return true;
    } catch (error) {
      throw new Error('Token validation failed: ' + error.message);
    }
  }

  /**
   * Generate new JWT token for client (for token refresh)
   */
  generateToken(clientId, expiresIn = '24h') {
    try {
      const payload = {
        client_id: clientId,
        type: 'client',
        iat: Math.floor(Date.now() / 1000)
      };

      return jwtUtils.generateAccessToken(payload, expiresIn);
    } catch (error) {
      throw new Error('Token generation failed: ' + error.message);
    }
  }

  /**
   * Refresh token if needed
   */
  async refreshTokenIfNeeded(token, clientId) {
    try {
      const expiration = this.authUtils.getTokenExpiration(token);
      
      if (!expiration) {
        return null; // No expiration info
      }

      const now = Date.now();
      const timeUntilExpiry = expiration - now;
      const oneHour = 60 * 60 * 1000;

      // Refresh if token expires in less than 1 hour
      if (timeUntilExpiry < oneHour) {
        const newToken = this.generateToken(clientId);
        return {
          access_token: newToken,
          expires_at: this.authUtils.getTokenExpiration(newToken)
        };
      }

      return null; // No refresh needed
    } catch (error) {
      return null;
    }
  }

  /**
   * Get user permissions for mobile client
   */
  async getUserPermissions(clientData) {
    return await this.authUtils.getUserPermissions({
      userType: 'client',
      userId: clientData.client_id
    });
  }

  /**
   * Validate client access to specific chat room
   */
  async validateRoomAccess(clientId, chatGroupId) {
    try {
      // Check if client has access to this chat group
      const { data: chatGroup, error } = await supabase
        .from('chat_group')
        .select('client_id, sys_user_id, status')
        .eq('chat_group_id', chatGroupId)
        .single();

      if (error || !chatGroup) {
        throw new Error('Chat group not found');
      }

      if (chatGroup.status !== 'active') {
        throw new Error('Chat group is inactive');
      }

      if (chatGroup.client_id !== clientId) {
        throw new Error('Access denied: client not authorized for this chat group');
      }

      return true;
    } catch (error) {
      throw new Error('Room access validation failed: ' + error.message);
    }
  }

  /**
   * Log mobile authentication events
   */
  logAuthEvent(eventType, socket, details = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      eventType,
      clientType: 'mobile',
      socketId: socket.id,
      ipAddress: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      details
    };
  }

  /**
   * Extract client info from token for logging (without verification)
   */
  extractClientInfoForLogging(token) {
    try {
      const payload = this.authUtils.extractJWTPayload(token);
      return {
        client_id: payload.client_id,
        exp: payload.exp,
        iat: payload.iat
      };
    } catch (error) {
      return { error: 'Failed to extract token info' };
    }
  }
}

module.exports = MobileSocketAuth;