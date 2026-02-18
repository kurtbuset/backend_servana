const { PERMISSIONS, isValidPermission } = require('../constants/permissions');

/**
 * Validates permission strings at runtime
 * Helps catch typos and invalid permissions early
 */
class PermissionValidator {
  /**
   * Validate a single permission
   * @param {string} permission - Permission to validate
   * @throws {Error} If permission is invalid
   */
  static validate(permission) {
    if (!permission || typeof permission !== 'string') {
      throw new Error(`Invalid permission: ${permission}. Must be a non-empty string.`);
    }

    if (!isValidPermission(permission)) {
      const validPermissions = Object.values(PERMISSIONS).join(', ');
      throw new Error(
        `Invalid permission: "${permission}". Valid permissions are: ${validPermissions}`
      );
    }

    return true;
  }

  /**
   * Validate multiple permissions
   * @param {string[]} permissions - Array of permissions to validate
   * @throws {Error} If any permission is invalid
   */
  static validateMany(permissions) {
    if (!Array.isArray(permissions)) {
      throw new Error('Permissions must be an array');
    }

    permissions.forEach(permission => this.validate(permission));
    return true;
  }

  /**
   * Get suggestions for misspelled permissions
   * @param {string} permission - Potentially misspelled permission
   * @returns {string[]} Array of similar permission names
   */
  static getSuggestions(permission) {
    const validPermissions = Object.values(PERMISSIONS);
    const suggestions = [];

    validPermissions.forEach(validPerm => {
      // Simple similarity check - could be enhanced with Levenshtein distance
      if (validPerm.includes(permission) || permission.includes(validPerm.split('_').pop())) {
        suggestions.push(validPerm);
      }
    });

    return suggestions;
  }
}

module.exports = PermissionValidator;