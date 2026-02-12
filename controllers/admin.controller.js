const express = require("express");
const adminService = require("../services/admin.service");
const getCurrentUser = require("../middleware/getCurrentUser");
const { checkPermission } = require("../middleware/checkPermission");

class AdminController {
  getRouter() {
    const router = express.Router();

    // Apply authentication middleware to all routes
    router.use(getCurrentUser);

    // Get all admins - requires account creation permission (admin-level)
    router.get("/",
      checkPermission('priv_can_create_account'),
      (req, res) => this.getAllAdmins(req, res)
    );

    // Add a new admin - requires account creation permission
    router.post("/",
      checkPermission('priv_can_create_account'),
      (req, res) => this.createAdmin(req, res)
    );

    // Update an existing admin - requires account creation permission
    router.put("/:id",
      checkPermission('priv_can_create_account'),
      (req, res) => this.updateAdmin(req, res)
    );

    // Toggle active status - requires account creation permission
    router.put("/:id/toggle",
      checkPermission('priv_can_create_account'),
      (req, res) => this.toggleAdminStatus(req, res)
    );

    return router;
  }
  /**
   * Get all admins
   */
  async getAllAdmins(req, res) {
    try {
      const admins = await adminService.getAllAdmins();
      res.status(200).json({
        admins,
        currentUserId: req.userId,
      });
    } catch (err) {
      console.error("Error fetching admins:", err.message);
      res.status(500).json({ error: "Failed to fetch admins" });
    }
  }

  /**
   * Create a new admin
   */
  async createAdmin(req, res) {
    try {
      const { sys_user_email, sys_user_password, sys_user_created_by } = req.body;

      if (!sys_user_email || !sys_user_password || !sys_user_created_by) {
        return res.status(400).json({ error: "Email, password, and created_by are required" });
      }

      const admin = await adminService.createAdmin(
        sys_user_email,
        sys_user_password,
        sys_user_created_by
      );

      res.status(201).json(admin);
    } catch (err) {
      console.error("Error adding admin:", err.message);
      res.status(400).json({ error: err.message });
    }
  }

  /**
   * Update an admin
   */
  async updateAdmin(req, res) {
    try {
      const { id } = req.params;
      const { sys_user_email, sys_user_password, sys_user_is_active, sys_user_updated_by } = req.body;

      if (!sys_user_updated_by) {
        return res.status(400).json({ error: "sys_user_updated_by is required" });
      }

      const admin = await adminService.updateAdmin(
        id,
        sys_user_email,
        sys_user_password,
        sys_user_is_active,
        sys_user_updated_by
      );

      res.status(200).json(admin);
    } catch (err) {
      console.error("Error updating admin:", err.message);
      res.status(500).json({ error: "Failed to update admin" });
    }
  }

  /**
   * Toggle admin active status
   */
  async toggleAdminStatus(req, res) {
    try {
      const { id } = req.params;
      const { sys_user_is_active, sys_user_updated_by } = req.body;

      if (typeof sys_user_is_active !== "boolean" || !sys_user_updated_by) {
        return res.status(400).json({
          error: "sys_user_is_active (boolean) and sys_user_updated_by are required",
        });
      }

      const admin = await adminService.toggleAdminStatus(id, sys_user_is_active, sys_user_updated_by);

      res.status(200).json(admin);
    } catch (err) {
      console.error("Error toggling admin active status:", err.message);
      res.status(500).json({ error: "Failed to toggle admin status" });
    }
  }
}

module.exports = new AdminController();
