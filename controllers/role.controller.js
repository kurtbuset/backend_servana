const express = require("express");
const roleService = require("../services/role.service");
const getCurrentUser = require("../middleware/getCurrentUser");

class RoleController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    // Get all roles with permissions
    router.get("/", (req, res) => this.getAllRoles(req, res));

    // Create new role
    router.post("/", (req, res) => this.createRole(req, res));

    // Update existing role
    router.put("/:id", (req, res) => this.updateRole(req, res));

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
}

module.exports = new RoleController();
