const express = require("express");
const departmentService = require("../services/department.service");
const getCurrentUser = require("../middleware/getCurrentUser");

class DepartmentController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    // Get all departments
    router.get("/", (req, res) => this.getAllDepartments(req, res));

    // Add a new department
    router.post("/", (req, res) => this.createDepartment(req, res));

    // Update an existing department
    router.put("/:id", (req, res) => this.updateDepartment(req, res));

    // Toggle dept_is_active status
    router.put("/:id/toggle", (req, res) => this.toggleDepartmentStatus(req, res));

    // Get members of a department
    router.get("/:id/members", (req, res) => this.getDepartmentMembers(req, res));

    return router;
  }
  /**
   * Get all departments
   */
  async getAllDepartments(req, res) {
    try {
      const departments = await departmentService.getAllDepartments();
      res.status(200).json(departments);
    } catch (err) {
      console.error("Error fetching departments:", err.message);
      res.status(500).json({ error: "Failed to fetch departments" });
    }
  }

  /**
   * Create a new department
   */
  async createDepartment(req, res) {
    try {
      const { dept_name, dept_created_by } = req.body;

      if (!dept_name || !dept_created_by) {
        return res.status(400).json({ error: "dept_name and dept_created_by are required" });
      }

      const department = await departmentService.createDepartment(dept_name, dept_created_by);
      res.status(201).json(department);
    } catch (err) {
      console.error("Error adding department:", err.message);
      res.status(500).json({ error: "Failed to add department" });
    }
  }

  /**
   * Update a department
   */
  async updateDepartment(req, res) {
    try {
      const { id } = req.params;
      const { dept_name, dept_is_active, dept_updated_by } = req.body;

      if (!dept_updated_by) {
        return res.status(400).json({ error: "dept_updated_by is required" });
      }

      const updateData = {
        dept_updated_at: new Date(),
        dept_updated_by,
      };

      if (dept_name !== undefined) updateData.dept_name = dept_name;
      if (dept_is_active !== undefined) updateData.dept_is_active = dept_is_active;

      const department = await departmentService.updateDepartment(id, updateData);
      res.status(200).json(department);
    } catch (err) {
      console.error("Error updating department:", err.message);
      res.status(500).json({ error: "Failed to update department" });
    }
  }

  /**
   * Toggle department active status
   */
  async toggleDepartmentStatus(req, res) {
    try {
      const { id } = req.params;
      const { dept_is_active, dept_updated_by } = req.body;

      if (typeof dept_is_active !== "boolean" || !dept_updated_by) {
        return res.status(400).json({ error: "dept_is_active (boolean) and dept_updated_by are required" });
      }

      const department = await departmentService.toggleDepartmentStatus(id, dept_is_active, dept_updated_by);
      res.status(200).json(department);
    } catch (err) {
      console.error("Error toggling department active status:", err.message);
      res.status(500).json({ error: "Failed to toggle department status" });
    }
  }

  /**
   * Get all members of a department from sys_user_department table
   */
  async getDepartmentMembers(req, res) {
    try {
      const { id } = req.params;
      console.log(`🔍 Fetching members for department ID: ${id}`);

      const members = await departmentService.getDepartmentMembers(id);
      console.log(`✅ Found ${members.length} members for department ${id}`);

      res.status(200).json({ members });
    } catch (err) {
      console.error("Error fetching department members:", err.message);
      res.status(500).json({ error: "Failed to fetch department members" });
    }
  }
}

module.exports = new DepartmentController();
