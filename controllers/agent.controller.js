const express = require("express");
const agentService = require("../services/agent.service");
const getCurrentUser = require("../middleware/getCurrentUser");

class AgentController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    // Fetch all agents with their departments
    router.get("/agents", (req, res) => this.getAllAgents(req, res));

    // Fetch all departments
    router.get("/departments", (req, res) => this.getActiveDepartments(req, res));

    // Update agent
    router.put("/agents/:id", (req, res) => this.updateAgent(req, res));

    // Create agent
    router.post("/agents", (req, res) => this.createAgent(req, res));

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
      console.error("Error fetching agents:", err.message);
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
      console.error("Error fetching departments:", err.message);
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

      // Update system_user
      await agentService.updateSystemUser(id, email, active);

      // Update sys_user_department
      if (departments) {
        // Delete existing
        await agentService.deleteUserDepartments(id);

        // Insert new departments
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
      console.error("Error updating agent:", err.message);
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
      console.error("Error adding new agent:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new AgentController();
