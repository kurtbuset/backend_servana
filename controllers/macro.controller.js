const express = require("express");
const macroService = require("../services/macro.service");
const roleService = require("../services/role.service");
const getCurrentUser = require("../middleware/getCurrentUser");
const { checkPermission } = require("../middleware/checkPermission");
const { PERMISSIONS } = require("../constants/permissions");

class MacroController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    // Get all macros for a specific role (dynamic) - requires view macros permission
    router.get(
      "/:roleType",
      checkPermission(PERMISSIONS.VIEW_MACROS),
      (req, res) => this.getMacrosByRoleType(req, res),
    );

    // Create new macro for a specific role (dynamic) - requires add macros permission
    router.post(
      "/:roleType",
      checkPermission(PERMISSIONS.ADD_MACROS),
      (req, res) => this.createMacro(req, res),
    );

    // Update existing macro - requires edit macros permission
    router.put(
      "/:roleType/:id",
      checkPermission(PERMISSIONS.EDIT_MACROS),
      (req, res) => this.updateMacro(req, res),
    );

    // Delete macro - requires delete macros permission
    router.delete(
      "/:roleType/:id",
      checkPermission(PERMISSIONS.DELETE_MACROS),
      (req, res) => this.deleteMacro(req, res),
    );

    return router;
  }

  /**
   * Get role ID from role type string dynamically
   * @param {string} roleType - "agent" or "client"
   * @returns {Promise<number>} Role ID
   */
  async getRoleIdFromType(roleType) {
    try {
      // Capitalize first letter to match database role names
      const roleName =
        roleType.charAt(0).toUpperCase() + roleType.slice(1).toLowerCase();

      const roleId = await roleService.getRoleId(roleName);

      return roleId;
    } catch (error) {
      console.error(
        `❌ Failed to get role ID for "${roleType}":`,
        error.message,
      );
      throw new Error(`Invalid role type: ${roleType}. ${error.message}`);
    }
  }

  /**
   * Get all macros for a specific role type
   */
  async getMacrosByRoleType(req, res) {
    try {
      const { roleType } = req.params;

      if (!roleType || !["agent", "client"].includes(roleType.toLowerCase())) {
        return res.status(400).json({
          error: "Invalid role type. Must be 'agent' or 'client'",
        });
      }

      const roleId = await this.getRoleIdFromType(roleType);
      const result = await macroService.getMacrosByRole(roleId);
      res.json({ data: result });
    } catch (error) {
      console.error(`Error fetching ${req.params.roleType} macros:`, error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  }

  /**
   * Create a new macro for a specific role type
   */
  async createMacro(req, res) {
    try {
      const { roleType } = req.params;
      const { text, dept_id, active = true, created_by } = req.body;

      if (!roleType || !["agent", "client"].includes(roleType.toLowerCase())) {
        return res.status(400).json({
          error: "Invalid role type. Must be 'agent' or 'client'",
        });
      }

      if (!text || !created_by) {
        return res
          .status(400)
          .json({ error: "Text and created_by are required" });
      }

      const roleId = await this.getRoleIdFromType(roleType);
      const result = await macroService.createMacro(
        text,
        dept_id,
        active,
        roleId,
        created_by,
      );
      res.status(201).json({ data: result });
    } catch (error) {
      console.error(`Error creating ${req.params.roleType} macro:`, error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update an existing macro
   */
  async updateMacro(req, res) {
    try {
      const { roleType, id } = req.params;
      const { text, active, dept_id, updated_by } = req.body;

      if (!roleType || !["agent", "client"].includes(roleType.toLowerCase())) {
        return res.status(400).json({
          error: "Invalid role type. Must be 'agent' or 'client'",
        });
      }

      if (!text || !updated_by) {
        return res
          .status(400)
          .json({ error: "Text and updated_by are required" });
      }

      // Note: For updates, we don't need to validate roleId since we're updating by macro ID
      // The roleType is just for consistency in the API structure
      const result = await macroService.updateMacro(
        id,
        text,
        active,
        dept_id,
        updated_by,
      );
      res.json({ data: result });
    } catch (error) {
      console.error(`Error updating ${req.params.roleType} macro:`, error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Delete a macro
   */
  async deleteMacro(req, res) {
    try {
      const { roleType, id } = req.params;

      if (!roleType || !["agent", "client"].includes(roleType.toLowerCase())) {
        return res.status(400).json({
          error: "Invalid role type. Must be 'agent' or 'client'",
        });
      }

      const result = await macroService.deleteMacro(id);
      res.json({ data: result });
    } catch (error) {
      console.error(`Error deleting ${req.params.roleType} macro:`, error);
      res.status(500).json({ error: error.message });
    }
  }
}
module.exports = new MacroController();
