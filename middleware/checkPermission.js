const profileService = require("../services/profile.service");
const PermissionValidator = require("../utils/permissionValidator");

/**
 * Middleware to check if user has specific privilege
 * @param {string} permission - The privilege to check (e.g., 'priv_can_manage_role')
 * @returns {Function} Express middleware function
 */
const checkPermission = (permission) => {
  // Validate permission at startup
  try {
    PermissionValidator.validate(permission);
  } catch (error) {
    console.error(`❌ Invalid permission in checkPermission middleware: ${error.message}`);
    const suggestions = PermissionValidator.getSuggestions(permission);
    if (suggestions.length > 0) {
      console.error(`💡 Did you mean: ${suggestions.join(', ')}?`);
    }
    throw error; // Fail fast during development
  }

  return async (req, res, next) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const hasPermission = await profileService.checkUserPermission(
        req.userId, 
        permission
      );

      if (!hasPermission) {
        return res.status(403).json({ 
          error: `Access denied. Required permission: ${permission}` 
        });
      }
      console.log('user has permission!')
      next();
    } catch (error) {
      console.error(`❌ Permission check failed for ${permission}:`, error.message);
      res.status(500).json({ error: "Permission check failed" });
    }
  };
};

/**
 * Middleware to check if user has ANY of the specified privileges
 * @param {string[]} permissions - Array of privileges to check
 * @returns {Function} Express middleware function
 */
const checkAnyPermission = (permissions) => {
  // Validate permissions at startup
  try {
    PermissionValidator.validateMany(permissions);
  } catch (error) {
    console.error(`❌ Invalid permissions in checkAnyPermission middleware: ${error.message}`);
    throw error; // Fail fast during development
  }

  return async (req, res, next) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Check if user has any of the required permissions
      for (const permission of permissions) {
        const hasPermission = await profileService.checkUserPermission(
          req.userId, 
          permission
        );
        
        if (hasPermission) {
          return next(); // User has at least one required permission
        }
      }

      return res.status(403).json({ 
        error: `Access denied. Required permissions: ${permissions.join(' OR ')}` 
      });
    } catch (error) {
      console.error(`❌ Permission check failed:`, error.message);
      res.status(500).json({ error: "Permission check failed" });
    }
  };
};

module.exports = {
  checkPermission,
  checkAnyPermission
};