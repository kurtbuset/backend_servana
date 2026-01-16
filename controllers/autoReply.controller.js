const express = require("express");
const autoReplyService = require("../services/autoReply.service");
const getCurrentUser = require("../middleware/getCurrentUser");

class AutoReplyController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    // Get all auto replies
    router.get("/", (req, res) => this.getAllAutoReplies(req, res));

    // Get active departments
    router.get("/departments/active", (req, res) => this.getActiveDepartments(req, res));

    // Get all departments
    router.get("/departments/all", (req, res) => this.getAllDepartments(req, res));

    // Create a new auto reply
    router.post("/", (req, res) => this.createAutoReply(req, res));

    // Update an auto reply
    router.put("/:id", (req, res) => this.updateAutoReply(req, res));

    // Toggle auto reply active status
    router.patch("/:id/toggle", (req, res) => this.toggleAutoReplyStatus(req, res));

    return router;
  }
  /**
   * Get all auto replies
   */
  async getAllAutoReplies(req, res) {
    try {
      const autoReplies = await autoReplyService.getAllAutoReplies();
      res.json(autoReplies);
    } catch (err) {
      console.error("Error fetching auto replies:", err.message);
      res.status(500).json({ error: "Failed to fetch auto replies" });
    }
  }

  /**
   * Get active departments
   */
  async getActiveDepartments(req, res) {
    try {
      const departments = await autoReplyService.getActiveDepartments();
      res.json(departments);
    } catch (err) {
      console.error("Error fetching active departments:", err.message);
      res.status(500).json({ error: "Failed to fetch active departments" });
    }
  }

  /**
   * Get all departments
   */
  async getAllDepartments(req, res) {
    try {
      const departments = await autoReplyService.getAllDepartments();
      res.json(departments);
    } catch (err) {
      console.error("Error fetching all departments:", err.message);
      res.status(500).json({ error: "Failed to fetch departments" });
    }
  }

  /**
   * Create a new auto reply
   */
  async createAutoReply(req, res) {
    try {
      const { message, dept_id, created_by } = req.body;

      if (!message || !dept_id || !created_by) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const autoReply = await autoReplyService.createAutoReply(message, dept_id, created_by);
      res.status(201).json(autoReply);
    } catch (err) {
      console.error("Error creating auto reply:", err.message);
      res.status(500).json({ error: "Failed to create auto reply" });
    }
  }

  /**
   * Update an auto reply
   */
  async updateAutoReply(req, res) {
    try {
      const { id } = req.params;
      const { message, dept_id, updated_by } = req.body;

      if (!updated_by) {
        return res.status(400).json({ error: "updated_by is required" });
      }

      const autoReply = await autoReplyService.updateAutoReply(id, message, dept_id, updated_by);
      res.json(autoReply);
    } catch (err) {
      console.error("Error updating auto reply:", err.message);
      res.status(500).json({ error: "Failed to update auto reply" });
    }
  }

  /**
   * Toggle auto reply active status
   */
  async toggleAutoReplyStatus(req, res) {
    try {
      const { id } = req.params;
      const { is_active, updated_by } = req.body;

      if (is_active === undefined || !updated_by) {
        return res.status(400).json({ error: "Missing is_active or updated_by" });
      }

      const autoReply = await autoReplyService.toggleAutoReplyStatus(id, is_active, updated_by);
      res.json(autoReply);
    } catch (err) {
      console.error("Error toggling auto reply status:", err.message);
      res.status(500).json({ error: "Failed to toggle auto reply status" });
    }
  }
}

module.exports = new AutoReplyController();
