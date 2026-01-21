const express = require("express");
const macroService = require("../services/macro.service");
const getCurrentUser = require("../middleware/getCurrentUser");

class MacroController {
  getRouterForRole(roleId, routePrefix = "") {
    const router = express.Router();

    router.use(getCurrentUser);

    // Get all macros for the specific role
    router.get("/", this.getMacrosByRole(roleId));

    // Create new macro for the specific role
    router.post("/", this.createMacro(roleId));

    // Update existing macro
    router.put("/:id", (req, res) => this.updateMacro(req, res));

    return router;
  }
  /**
   * Get all macros for a specific role
   */
  getMacrosByRole(roleId) {
    return async (req, res) => {
      try {
        const result = await macroService.getMacrosByRole(roleId);
        res.json(result);
      } catch (error) {
        console.error("Error fetching macros:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
      }
    };
  }

  /**
   * Create a new macro
   */
  createMacro(roleId) {
    return async (req, res) => {
      try {
        const { text, dept_id, active = true, created_by } = req.body;

        if (!text || !created_by) {
          return res.status(400).json({ error: "Text and created_by are required" });
        }

        const result = await macroService.createMacro(text, dept_id, active, roleId, created_by);
        res.status(201).json(result);
      } catch (error) {
        console.error("Error creating macro:", error);
        res.status(500).json({ error: error.message });
      }
    };
  }

  /**
   * Update an existing macro
   */
  async updateMacro(req, res) {
    try {
      const { id } = req.params;
      const { text, active, dept_id, updated_by } = req.body;

      if (!text || !updated_by) {
        return res.status(400).json({ error: "Text and updated_by are required" });
      }

      const result = await macroService.updateMacro(id, text, active, dept_id, updated_by);
      res.json(result);
    } catch (error) {
      console.error("Error updating macro:", error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new MacroController();
