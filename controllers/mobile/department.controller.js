const express = require("express");
const mobileDepartmentService = require("../../services/mobile/department.service");
const getCurrentMobileUser = require("../../middleware/getCurrentMobileUser");

class MobileDepartmentController {
  getRouter() {
    const router = express.Router();

    // Get all active departments (public route)
    router.get("/active", (req, res) => this.getActiveDepartments(req, res));

    // Protected routes
    router.use(getCurrentMobileUser);

    return router;
  }
  /**
   * Get all active departments
   */
  async getActiveDepartments(req, res) {
    try {
      const departments = await mobileDepartmentService.getActiveDepartments();
      res.json({ departments });
    } catch (error) {
      console.error("Error fetching departments:", error);
      res.status(500).json({ error: "Failed to fetch departments" });
    }
  }
}

module.exports = new MobileDepartmentController();
