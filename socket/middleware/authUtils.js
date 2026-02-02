const supabase = require('../../helpers/supabaseClient');

/**
 * Authentication Utilities
 * Shared utilities for socket authentication
 */
class AuthUtils {
  /**
   * Get user permissions based on role and user type
   */
  async getUserPermissions(authResult) {
    const permissions = {
      canJoinRooms: false,
      canSendMessages: false,
      canViewMessages: false,
      canTransferChats: false,
      canAccessAllDepartments: false,
      maxRoomsPerUser: 1,
      rateLimits: {
        messagesPerMinute: 30,
        roomJoinsPerMinute: 10
      }
    };

    if (authResult.userType === 'client') {
      // Client permissions
      permissions.canJoinRooms = true;
      permissions.canSendMessages = true;
      permissions.canViewMessages = true;
      permissions.maxRoomsPerUser = 1; // Clients can only be in one room
      permissions.rateLimits.messagesPerMinute = 30;
      permissions.rateLimits.roomJoinsPerMinute = 5;
    } else if (authResult.userType === 'agent') {
      // Agent permissions - get from role
      const rolePermissions = await this.getAgentRolePermissions(authResult.roleId);
      
      permissions.canJoinRooms = true;
      permissions.canSendMessages = true;
      permissions.canViewMessages = true;
      permissions.canTransferChats = rolePermissions.canTransferChats || false;
      permissions.canAccessAllDepartments = rolePermissions.isAdmin || false;
      permissions.maxRoomsPerUser = rolePermissions.isAdmin ? 50 : 10;
      permissions.rateLimits.messagesPerMinute = rolePermissions.isAdmin ? 200 : 100;
      permissions.rateLimits.roomJoinsPerMinute = 20;
    }

    return permissions;
  }

  /**
   * Get agent role permissions from database
   */
  async getAgentRolePermissions(roleId) {
    try {
      const { data: role, error } = await supabase
        .from('role')
        .select('role_name')
        .eq('role_id', roleId)
        .single();

      if (error || !role) {
        console.warn(`Role not found for roleId: ${roleId}`);
        return { canTransferChats: false, isAdmin: false };
      }

      // Determine permissions based on role name
      const roleName = role.role_name.toLowerCase();
      
      return {
        canTransferChats: roleName.includes('admin') || roleName.includes('supervisor'),
        isAdmin: roleName.includes('admin'),
        canViewAllChats: roleName.includes('admin') || roleName.includes('supervisor'),
        canManageUsers: roleName.includes('admin')
      };
    } catch (error) {
      console.error('Error fetching role permissions:', error);
      return { canTransferChats: false, isAdmin: false };
    }
  }

  /**
   * Validate token format and basic structure
   */
  validateTokenFormat(token, tokenType = 'jwt') {
    if (!token || typeof token !== 'string') {
      throw new Error('Token must be a non-empty string');
    }

    if (tokenType === 'jwt') {
      // Basic JWT format validation
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }
    }

    return true;
  }

  /**
   * Extract user info from JWT token (without verification)
   */
  extractJWTPayload(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return payload;
    } catch (error) {
      throw new Error('Failed to extract JWT payload: ' + error.message);
    }
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(token) {
    try {
      const payload = this.extractJWTPayload(token);
      
      if (!payload.exp) {
        return false; // No expiration claim
      }

      const now = Math.floor(Date.now() / 1000);
      return payload.exp < now;
    } catch (error) {
      return true; // Assume expired if we can't parse
    }
  }

  /**
   * Get token expiration time
   */
  getTokenExpiration(token) {
    try {
      const payload = this.extractJWTPayload(token);
      return payload.exp ? payload.exp * 1000 : null; // Convert to milliseconds
    } catch (error) {
      return null;
    }
  }

  /**
   * Sanitize user input to prevent injection attacks
   */
  sanitizeInput(input) {
    if (typeof input !== 'string') {
      return input;
    }

    // Remove potentially dangerous characters
    return input
      .replace(/[<>]/g, '') // Remove HTML tags
      .replace(/['"]/g, '') // Remove quotes
      .replace(/[\\]/g, '') // Remove backslashes
      .trim();
  }

  /**
   * Validate room ID format
   */
  validateRoomId(roomId) {
    if (!roomId) {
      throw new Error('Room ID is required');
    }

    // Convert to number and validate
    const numericRoomId = parseInt(roomId);
    if (isNaN(numericRoomId) || numericRoomId <= 0) {
      throw new Error('Room ID must be a positive integer');
    }

    return numericRoomId;
  }

  /**
   * Validate message content
   */
  validateMessageContent(content) {
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

    return this.sanitizeInput(trimmedContent);
  }

  /**
   * Generate secure random string for session IDs
   */
  generateSecureId(length = 32) {
    const crypto = require('crypto');
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash sensitive data for logging
   */
  hashForLogging(data) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(String(data)).digest('hex').substring(0, 8);
  }

  /**
   * Check if IP address is in allowed range (for future IP restrictions)
   */
  isIPAllowed(ipAddress) {
    // For now, allow all IPs
    // TODO: Implement IP whitelist/blacklist functionality
    return true;
  }

  /**
   * Get user-friendly error message
   */
  getUserFriendlyError(error) {
    const errorMap = {
      'Invalid token': 'Your session has expired. Please log in again.',
      'Token expired': 'Your session has expired. Please log in again.',
      'User not found': 'Account not found. Please check your credentials.',
      'Account inactive': 'Your account has been deactivated. Please contact support.',
      'Access denied': 'You do not have permission to perform this action.',
      'Rate limit exceeded': 'Too many requests. Please wait a moment and try again.'
    };

    return errorMap[error.message] || 'An error occurred. Please try again.';
  }
}

module.exports = AuthUtils;