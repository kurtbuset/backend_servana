const express = require("express");
const roleService = require("../services/role.service");
const getCurrentUser = require("../middleware/getCurrentUser");
const { checkPermission } = require("../middleware/checkPermission");

class RoleController {
  getRouter() {
    const router = express.Router();

    // Apply authentication middleware to all routes
    router.use(getCurrentUser);

    // Get all roles with permissions - requires role management permission
    router.get("/", 
      checkPermission('priv_can_manage_role'),
      (req, res) => this.getAllRoles(req, res)
    );

    // Create new role - requires role management permission
    router.post("/", 
      checkPermission('priv_can_manage_role'),
      (req, res) => this.createRole(req, res)
    );

    // Update existing role - requires role management permission
    router.put("/:id", 
      checkPermission('priv_can_manage_role'),
      (req, res) => this.updateRole(req, res)
    );

    // Get members for a specific role - requires role management permission
    router.get("/:roleId/members", 
      checkPermission('priv_can_manage_role'),
      (req, res) => this.getRoleMembers(req, res)
    );

    // Update member permissions - requires role management permission
    router.put("/:roleId/members/:userId/permissions", 
      checkPermission('priv_can_manage_role'),
      (req, res) => this.updateMemberPermissions(req, res)
    );

    return router;
  }
  /**
   * Get all roles with permissions
   */
  async getAllRoles(req, res) {
    try {
      const roles = await roleService.getAllRoles();
      res.json(roles);
    } catch (err) {
      console.error("Error fetching roles:", err.message);
      res.status(500).json({ error: "Failed to fetch roles" });
    }
  }

  /**
   * Create a new role
   */
  async createRole(req, res) {
    try {
      const { name, permissions, created_by } = req.body;

      if (!name || !created_by) {
        return res.status(400).json({ error: "Name and created_by are required" });
      }

      const roleData = await roleService.createRole(name, permissions, created_by);

      res.json({ message: "Role created", role: roleData });
    } catch (err) {
      console.error("Error creating role:", err.message);
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Update an existing role
   */
  async updateRole(req, res) {
    try {
      const roleId = req.params.id;
      const { name, active, permissions, updated_by } = req.body;

      if (!updated_by) {
        return res.status(400).json({ error: "updated_by is required" });
      }

      // Get role to find priv_id
      const role = await roleService.getRoleById(roleId);

      // Update privileges if permissions are provided
      if (Array.isArray(permissions)) {
        await roleService.updatePrivileges(role.priv_id, permissions, updated_by);
      }

      // Update role details
      await roleService.updateRole(roleId, name, active, updated_by);

      res.json({ message: "Role updated" });
    } catch (err) {
      console.error("Error updating role:", err.message);

      if (err.message === "Role not found") {
        return res.status(404).json({ error: err.message });
      }

      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get all members for a specific role
   */
  async getRoleMembers(req, res) {
    try {
      const roleId = parseInt(req.params.roleId);

      if (!roleId || isNaN(roleId)) {
        return res.status(400).json({ error: "Valid role ID is required" });
      }

      const members = await roleService.getRoleMembers(roleId);

      res.json({
        roleId: roleId,
        members: members,
        totalCount: members.length
      });
    } catch (err) {
      console.error("Error fetching role members:", err.message);
      res.status(500).json({ error: "Failed to fetch role members" });
    }
  }

  /**
   * Update member permissions
   */
  async updateMemberPermissions(req, res) {
    try {
      const roleId = parseInt(req.params.roleId);
      const userId = parseInt(req.params.userId);
      const { permission, value } = req.body;

      // Validation
      if (!roleId || isNaN(roleId)) {
        return res.status(400).json({ error: "Valid role ID is required" });
      }

      if (!userId || isNaN(userId)) {
        return res.status(400).json({ error: "Valid user ID is required" });
      }

      if (!permission || typeof value !== 'boolean') {
        return res.status(400).json({ error: "Permission and boolean value are required" });
      }

      // Currently only supporting chat permission updates
      if (permission !== 'priv_can_view_message') {
        return res.status(400).json({ error: "Only 'priv_can_view_message' permission is supported" });
      }

      // Update the permission
      await roleService.updateUserChatPermission(userId, value);

      res.json({
        success: true,
        message: "Member permission updated successfully",
        updatedUser: {
          userId: userId,
          permission: permission,
          value: value
        }
      });
    } catch (err) {
      console.error("Error updating member permission:", err.message);
      res.status(500).json({ error: "Failed to update member permission" });
    }
  }
}

module.exports = new RoleController();
