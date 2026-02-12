const express = require("express");
const agentService = require("../services/agent.service");
const getCurrentUser = require("../middleware/getCurrentUser");
const { checkPermission, checkAnyPermission } = require("../middleware/checkPermission");
const { PERMISSIONS } = require("../constants/permissions");

class AgentController {
  getRouter() {
    const router = express.Router();

    // Apply authentication middleware to all routes
    router.use(getCurrentUser);

    // Fetch all agents with their departments - requires role management permission
    router.get("/agents", 
      checkAnyPermission([PERMISSIONS.MANAGE_ROLE, PERMISSIONS.CREATE_ACCOUNT]),
      (req, res) => this.getAllAgents(req, res)
    );

    // Fetch all departments - requires department management permission
    router.get("/departments", 
      checkPermission(PERMISSIONS.MANAGE_DEPT),
      (req, res) => this.getActiveDepartments(req, res)
    );

    // Update agent - requires role management permission
    router.put("/agents/:id", 
      checkPermission(PERMISSIONS.MANAGE_ROLE),
      (req, res) => this.updateAgent(req, res)
    );

    // Create agent - requires account creation permission
    router.post("/agents", 
      checkPermission(PERMISSIONS.CREATE_ACCOUNT),
      (req, res) => this.createAgent(req, res)
    );

    return router;
  }
  /**
   * Get all agents with their departments
   */
  async getAllAgents(req, res) {
    try {
      const agents = await agentService.getAllAgents();
      res.status(200).json(agents);
    } catch (err) {
      console.error("❌ Error fetching agents:", err.message);
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get all active departments
   */
  async getActiveDepartments(req, res) {
    try {
      const departments = await agentService.getActiveDepartments();
      res.status(200).json(departments);
    } catch (err) {
      console.error("❌ Error fetching departments:", err.message);
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Update an agent
   */
  async updateAgent(req, res) {
    try {
      const { id } = req.params;
      const { email, active, departments, password } = req.body;

      // Get system user
      const sysUser = await agentService.getSystemUserById(id);
      const authUserId = sysUser.supabase_user_id;

      // Update system_user (includes cache invalidation)
      await agentService.updateSystemUser(id, email, active);

      // Update sys_user_department (includes cache invalidation)
      if (departments) {
        // Delete existing (includes cache invalidation)
        await agentService.deleteUserDepartments(id);

        // Insert new departments (includes cache invalidation)
        if (departments.length > 0) {
          const deptRows = await agentService.getDepartmentIdsByNames(departments);
          await agentService.insertUserDepartments(
            id,
            deptRows.map((d) => d.dept_id)
          );
        }
      }

      // Update Supabase Auth
      if (authUserId) {
        await agentService.updateAuthUser(authUserId, email, password);
      }

      res.status(200).json({ message: "Agent updated successfully" });
    } catch (err) {
      console.error("❌ Error updating agent:", err.message);
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Create a new agent
   */
  async createAgent(req, res) {
    try {
      const { email, password, departments, role_id } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
      }

      const result = await agentService.createAgent(email, password, departments, role_id);

      res.status(201).json(result);
    } catch (err) {
      console.error("❌ Error adding new agent:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new AgentController();
