const express = require("express");
const changeRoleService = require("../services/changeRole.service");
const getCurrentUser = require("../middleware/getCurrentUser");
const { checkPermission } = require("../middleware/checkPermission");
const { PERMISSIONS } = require("../constants/permissions")

class ChangeRoleController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    // Get all users with their roles - requires view change roles permission
    router.get("/", 
      checkPermission(PERMISSIONS.VIEW_CHANGE_ROLES),
      (req, res) => this.getAllUsersWithRoles(req, res)
    );

    // Get all roles (active + inactive) - requires view change roles permission
    router.get("/roles", 
      checkPermission(PERMISSIONS.VIEW_CHANGE_ROLES),
      (req, res) => this.getAllRoles(req, res)
    );

    // Update a user's role or active status - requires edit change roles permission
    router.put("/:id", 
      checkPermission(PERMISSIONS.EDIT_CHANGE_ROLES),
      (req, res) => this.updateUserRole(req, res)
    );

    return router;
  }
  /**
   * Get all users with their roles
   */
  async getAllUsersWithRoles(req, res) {
    try {
      const users = await changeRoleService.getAllUsersWithRoles();
      res.status(200).json({ data: users });
    } catch (err) {
      console.error("Error fetching users:", err.message);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  }

  /**
   * Get all roles
   */
  async getAllRoles(req, res) {
    try {
      const roles = await changeRoleService.getAllRoles();
      res.status(200).json({ data: roles });
    } catch (err) {
      console.error("Error fetching roles:", err.message);
      res.status(500).json({ error: "Failed to fetch roles" });
    }
  }

  /**
   * Update user's role or active status
   */
  async updateUserRole(req, res) {
    try {
      const { id } = req.params;
      const { role_id, sys_user_is_active } = req.body;
      const updatedBy = req.userId || null;

      const updatedUser = await changeRoleService.updateUserRole(
        id,
        role_id,
        sys_user_is_active,
        updatedBy
      );

      res.status(200).json({ data: updatedUser });
    } catch (err) {
      console.error("Error updating user:", err.message);
      res.status(500).json({ error: "Failed to update user" });
    }
  }
}

module.exports = new ChangeRoleController();
