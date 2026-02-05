const supabase = require('../../helpers/supabaseClient');
const AuthUtils = require('./authUtils');

/**
 * Web Socket Authentication
 * Handles authentication for web clients using HTTP-only cookies
 */
class WebSocketAuth {
  constructor() {
    this.authUtils = new AuthUtils();
  }

  /**
   * Authenticate web client using access_token cookie
   */
  async authenticate(socket) {
    try {
      // 1. Extract access token from cookies
      const token = this.extractAccessToken(socket);
      
      // 2. Validate token format
      this.authUtils.validateTokenFormat(token, 'supabase');
      
      // 3. Verify token with Supabase
      const supabaseUser = await this.verifySupabaseToken(token);
      
      // 4. Get system user data
      const systemUser = await this.getSystemUser(supabaseUser.id);
      
      // 5. Return authenticated user context
      return {
        userId: systemUser.sys_user_id,
        supabaseUserId: supabaseUser.id,
        userType: 'agent',
        roleId: systemUser.role_id,
        profId: systemUser.prof_id,
        firstName: systemUser.profile?.prof_firstname,
        lastName: systemUser.profile?.prof_lastname,
        email: supabaseUser.email,
        isActive: true,
        token: token,
        socket: socket
      };
    } catch (error) {
      console.error('❌ Web authentication failed:', error.message);
      throw new Error(`Web authentication failed: ${error.message}`);
    }
  }

  /**
   * Extract access token from socket handshake cookies
   */
  extractAccessToken(socket) {
    const cookies = socket.handshake.headers.cookie;
    
    if (!cookies) {
      throw new Error('No cookies found in request');
    }

    // Parse cookies to find access_token
    const cookieArray = cookies.split(';');
    let accessToken = null;

    for (const cookie of cookieArray) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'access_token') {
        accessToken = decodeURIComponent(value);
        break;
      }
    }

    if (!accessToken) {
      throw new Error('Access token not found in cookies');
    }

    return accessToken;
  }

  /**
   * Verify token with Supabase Auth
   */
  async verifySupabaseToken(token) {
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      
      if (authError) {
        console.error('Supabase auth error:', authError);
        throw new Error('Invalid or expired token');
      }

      if (!authData?.user) {
        throw new Error('No user data returned from Supabase');
      }

      // Check if token is expired
      if (this.authUtils.isTokenExpired(token)) {
        throw new Error('Token has expired');
      }

      return authData.user;
    } catch (error) {
      if (error.message.includes('JWT')) {
        throw new Error('Invalid token format');
      }
      throw error;
    }
  }

  /**
   * Get system user data from database
   */
  async getSystemUser(supabaseUserId) {
    try {
      const { data: systemUser, error } = await supabase
        .from('sys_user')
        .select(`
          sys_user_id,
          role_id,
          prof_id,
          sys_user_email,
          sys_user_is_active,
          role:role_id (
            role_name
          ),
          profile:prof_id (
            prof_firstname,
            prof_lastname
          )
        `)
        .eq('supabase_user_id', supabaseUserId)
        .eq('sys_user_is_active', true)
        .single();

      if (error) {
        console.error('Database error fetching system user:', error);
        throw new Error('Failed to fetch user data');
      }

      if (!systemUser) {
        throw new Error('System user not found or inactive');
      }

      return systemUser;
    } catch (error) {
      if (error.message.includes('System user not found')) {
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

      // Verify with Supabase
      const { data: authData, error } = await supabase.auth.getUser(token);
      
      if (error || !authData?.user) {
        throw new Error('Token validation failed');
      }

      return true;
    } catch (error) {
      throw new Error('Token validation failed: ' + error.message);
    }
  }

  /**
   * Refresh token if needed (for future implementation)
   */
  async refreshTokenIfNeeded(socket) {
    try {
      const refreshToken = this.extractRefreshToken(socket);
      
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      // Check if access token is close to expiry
      const accessToken = this.extractAccessToken(socket);
      const expiration = this.authUtils.getTokenExpiration(accessToken);
      
      if (!expiration) {
        return null; // No expiration info, can't determine if refresh needed
      }

      const now = Date.now();
      const timeUntilExpiry = expiration - now;
      const fiveMinutes = 5 * 60 * 1000;

      // Refresh if token expires in less than 5 minutes
      if (timeUntilExpiry < fiveMinutes) {
        return await this.refreshToken(refreshToken);
      }

      return null; // No refresh needed
    } catch (error) {
      console.warn('Token refresh check failed:', error.message);
      return null;
    }
  }

  /**
   * Extract refresh token from cookies
   */
  extractRefreshToken(socket) {
    const cookies = socket.handshake.headers.cookie;
    
    if (!cookies) {
      return null;
    }

    const cookieArray = cookies.split(';');
    
    for (const cookie of cookieArray) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'refresh_token') {
        return decodeURIComponent(value);
      }
    }

    return null;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken) {
    try {
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: refreshToken
      });

      if (error || !data?.session) {
        throw new Error('Token refresh failed');
      }

      return {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      };
    } catch (error) {
      throw new Error('Token refresh failed: ' + error.message);
    }
  }

  /**
   * Get user permissions for web client
   */
  async getUserPermissions(systemUser) {
    return await this.authUtils.getUserPermissions({
      userType: 'agent',
      roleId: systemUser.role_id,
      userId: systemUser.sys_user_id
    });
  }

  /**
   * Log web authentication events
   */
  logAuthEvent(eventType, socket, details = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      eventType,
      clientType: 'web',
      socketId: socket.id,
      ipAddress: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      details
    };

  }
}

module.exports = WebSocketAuth;