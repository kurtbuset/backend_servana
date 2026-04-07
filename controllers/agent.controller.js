const express = require("express");
const agentService = require("../services/agent.service");
const cacheService = require("../services/cache.service");
const getCurrentUser = require("../middleware/getCurrentUser");
const { checkPermission, checkAnyPermission } = require("../middleware/checkPermission");
const { PERMISSIONS } = require("../constants/permissions");

class AgentController {
  getRouter() {
    const router = express.Router();

    // Apply authentication middleware to all routes
    router.use(getCurrentUser);

    // Fetch all agents with their departments - requires view manage agents permission
    router.get("/agents", 
      checkPermission(PERMISSIONS.VIEW_MANAGE_AGENTS),
      (req, res) => this.getAllAgents(req, res)
    );

    // Fetch all departments - requires view department permission
    router.get("/departments", 
      checkPermission(PERMISSIONS.VIEW_DEPT),
      (req, res) => this.getActiveDepartments(req, res)
    );

    // Update agent - requires edit manage agents permission
    router.put("/agents/:id", 
      checkPermission(PERMISSIONS.EDIT_MANAGE_AGENTS),
      (req, res) => this.updateAgent(req, res)
    );

    // Create agent - requires create agent account permission
    router.post("/agents", 
      checkPermission(PERMISSIONS.CREATE_AGENT_ACCOUNT),
      (req, res) => this.createAgent(req, res)
    );

    // Get all user presences (online status)
    router.get("/presence", 
      checkPermission(PERMISSIONS.VIEW_MANAGE_AGENTS),
      (req, res) => this.getAllPresences(req, res)
    );

    // Get specific user presence
    router.get("/presence/:userId", 
      checkPermission(PERMISSIONS.VIEW_MANAGE_AGENTS),
      (req, res) => this.getUserPresence(req, res)
    );

    return router;
  }
  /**
   * Get all agents with their departments
   */
  async getAllAgents(req, res) {
    try {
      const agents = await agentService.getAllAgents();
      res.status(200).json({ data: agents });
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
      res.status(200).json({ data: departments });
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

      res.status(200).json({ data: { message: "Agent updated successfully" } });
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

      res.status(201).json({ data: result });
    } catch (err) {
      console.error("❌ Error adding new agent:", err.message);
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get all user presences
   */
  async getAllPresences(req, res) {
    try {
      const presences = await cacheService.getAllUserPresence();
      
      // Convert object to array for easier frontend consumption
      const presenceArray = Object.entries(presences).map(([userId, data]) => ({
        userId: parseInt(userId),
        ...data
      }));

      res.status(200).json({ 
        data: presenceArray,
        count: presenceArray.length 
      });
    } catch (err) {
      console.error("❌ Error fetching presences:", err.message);
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get specific user presence
   */
  async getUserPresence(req, res) {
    try {
      const { userId } = req.params;
      const presence = await cacheService.getUserPresence(userId);

      if (!presence) {
        return res.status(404).json({ error: "User presence not found" });
      }

      res.status(200).json({ data: presence });
    } catch (err) {
      console.error("❌ Error fetching user presence:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new AgentController();
