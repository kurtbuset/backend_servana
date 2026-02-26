const express = require("express");
const clientAccountService = require("../../services/mobile/clientAccount.service");
const getCurrentMobileUser = require("../../middleware/getCurrentMobileUser");

class ClientAccountController {
  getRouter() {
    const router = express.Router();

    // Protected routes (authentication required)
    router.get("/auth/validate", getCurrentMobileUser, (req, res) =>
      this.validateToken(req, res),
    );
    router.post("/profile/complete", getCurrentMobileUser, (req, res) =>
      this.completeProfile(req, res),
    );
    router.patch(
      "/chat_group/:id/set-department",
      getCurrentMobileUser,
      (req, res) => this.setChatGroupDepartment(req, res),
    );
    router.put("/:prof_id", getCurrentMobileUser, (req, res) =>
      this.updateProfile(req, res),
    );
    router.post("/client", getCurrentMobileUser, (req, res) =>
      this.sendClientMessage(req, res),
    );

    // Global error handler
    router.use((err, req, res, next) => {
      console.error("Unhandled error:", err);
      res
        .status(500)
        .json({ error: "Internal server error", details: String(err) });
    });

    return router;
  }

  /**
   * Validate Token
   */
  async validateToken(req, res) {
    try {
      const clientId = req.userId; // From getCurrentMobileUser middleware

      // Call service layer
      const client = await clientAccountService.validateTokenFlow(clientId);

      res.json({
        message: "Token is valid",
        client,
      });
    } catch (err) {
      console.error("Validate token error:", err);

      if (err.message === "Client not found") {
        return res.status(404).json({ error: err.message });
      }

      if (err.message === "Account is inactive") {
        return res.status(403).json({ error: err.message });
      }

      res.status(500).json({ error: "Failed to validate token" });
    }
  }

  /**
   * Complete Profile
   */
  async completeProfile(req, res) {
    try {
      const clientId = req.userId; // From getCurrentMobileUser middleware
      const { firstname, lastname } = req.body;

      // Validate input
      if (!firstname || !lastname) {
        return res
          .status(400)
          .json({ error: "First name and last name are required" });
      }

      // Call service layer
      const result = await clientAccountService.completeProfileFlow(
        clientId,
        firstname,
        lastname,
      );

      res.json({
        message: result.isUpdate
          ? "Profile updated successfully"
          : "Profile created successfully",
        profile: result.profile,
      });
    } catch (err) {
      console.error("Complete profile error:", err);

      if (err.message === "Client not found") {
        return res.status(404).json({ error: err.message });
      }

      res.status(500).json({ error: "Failed to update profile" });
    }
  }

  /**
   * Set chat group department
   */
  async setChatGroupDepartment(req, res) {
    try {
      const id = Number(req.params.id);
      const { dept_id } = req.body;

      // Validate input
      if (!dept_id) {
        return res.status(400).json({ error: "Department ID is required" });
      }

      // Call service layer
      const result = await clientAccountService.setChatGroupDepartmentFlow(
        id,
        dept_id,
      );

      res.status(200).json({
        message: "Department assigned successfully and message created",
        updated: result.updatedGroup,
      });
    } catch (err) {
      console.error("Set department error:", err);

      if (err.message === "Failed to assign department") {
        return res.status(404).json({ error: "Chat group not found" });
      }

      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Update profile
   */
  async updateProfile(req, res) {
    try {
      const { prof_id } = req.params;
      const {
        prof_firstname,
        prof_middlename,
        prof_lastname,
        prof_address,
        prof_street_address,
        prof_region_info,
        prof_postal_code,
        prof_date_of_birth,
      } = req.body;

      // Call service layer
      const profile = await clientAccountService.updateProfileFlow(prof_id, {
        prof_firstname,
        prof_middlename,
        prof_lastname,
        prof_address,
        prof_street_address,
        prof_region_info,
        prof_postal_code,
        prof_date_of_birth,
      });

      res.status(200).json({
        message: "Profile updated successfully",
        profile,
      });
    } catch (err) {
      console.error("Update profile error:", err);

      if (err.message === "First name and last name are required") {
        return res.status(400).json({ error: err.message });
      }

      res.status(500).json({ message: err.message || "Internal server error" });
    }
  }

  /**
   * Send client message
   */
  async sendClientMessage(req, res) {
    try {
      const { message, clientId, deptId } = req.body;

      // Call service layer
      const messageData = await clientAccountService.sendClientMessageFlow(
        message,
        clientId,
        deptId,
      );

      res.json({ success: true, message: messageData });
    } catch (err) {
      console.error("❌ Error sending client message:", err);

      if (err.message === "Missing message or clientId") {
        return res.status(400).json({ error: err.message });
      }

      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new ClientAccountController();
