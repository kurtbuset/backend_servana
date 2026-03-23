const express = require("express");
const multer = require("multer");
const profileService = require("../services/profile.service");
const getCurrentUser = require("../middleware/getCurrentUser");
const { checkPermission } = require("../middleware/checkPermission");
const { PERMISSIONS } = require("../constants/permissions");

class ProfileController {
  getRouter() {
    const router = express.Router();
    const upload = multer({ storage: multer.memoryStorage() });

    // All profile routes require an authenticated user
    router.use(getCurrentUser);

    // Get current user profile
    router.get("/", (req, res) => this.getCurrentUserProfile(req, res));

    // Update current user profile
    router.put("/", checkPermission(PERMISSIONS.MANAGE_PROFILE), (req, res) => this.updateCurrentUserProfile(req, res));

    // Upload profile image
    router.post("/image", checkPermission(PERMISSIONS.MANAGE_PROFILE), upload.single("image"), (req, res) => this.uploadProfileImage(req, res));

    // Get agent status
    router.get("/agent-status", (req, res) => this.getAgentStatus(req, res));

    // Update agent status
    router.put("/agent-status", (req, res) => this.updateAgentStatus(req, res));

    return router;
  }
  /**
   * Get current user profile
   */
  async getCurrentUserProfile(req, res) {
    try {
      const sysUserId = req.userId;

      const { userRow, profRow } = await profileService.fetchUserAndProfile(sysUserId);
      
      // Only fetch image if profile exists and has a prof_id
      let image = null;
      if (profRow && profRow.prof_id) {
        image = await profileService.fetchCurrentImage(profRow.prof_id);
      }

      // Fetch user's role privileges
      let privileges = null;
      if (userRow.role_id) {
        try {
          // First get the role to find the priv_id
          const { data: roleData, error: roleError } = await require("../helpers/supabaseClient")
            .from("role")
            .select("priv_id, role_name")
            .eq("role_id", userRow.role_id)
            .single();

          if (!roleError && roleData?.priv_id) {
            // Then fetch the privilege data using the priv_id
            const { data: privData, error: privError } = await require("../helpers/supabaseClient")
              .from("privilege")
              .select(`
                priv_id,
                priv_can_view_message,
                priv_can_message,
                priv_can_manage_profile,
                priv_can_use_canned_mess,
                priv_can_end_chat,
                priv_can_transfer,
                priv_can_view_dept,
                priv_can_add_dept,
                priv_can_edit_dept,
                priv_can_manage_dept,
                priv_can_assign_dept,
                priv_can_manage_role,
                priv_can_assign_role,
                priv_can_create_account,
                priv_can_view_auto_reply,
                priv_can_add_auto_reply,
                priv_can_edit_auto_reply,
                priv_can_delete_auto_reply,
                priv_can_manage_auto_reply,
                priv_can_view_macros,
                priv_can_add_macros,
                priv_can_edit_macros,
                priv_can_delete_macros,
                priv_can_view_change_roles,
                priv_can_edit_change_roles,
                priv_can_view_manage_agents,
                priv_can_view_agents_info,
                priv_can_create_agent_account,
                priv_can_edit_manage_agents,
                priv_can_edit_dept_manage_agents,
                priv_can_view_analytics_manage_agents
              `)
              .eq("priv_id", roleData.priv_id)
              .single();

            if (!privError && privData) {
              privileges = privData;
              // Privilege values available
            } else {
              console.error("❌ Failed to fetch privilege data:", privError);
              console.error("❌ Attempted to fetch priv_id:", roleData.priv_id);
            }
          } else {
            console.error("❌ Failed to fetch role data or no priv_id found:", roleError);
            console.error("❌ Attempted to fetch role_id:", userRow.role_id);
          }
        } catch (privError) {
          console.error("❌ Exception while fetching user privileges:", privError.message);
        }
      } else {
        console.warn("⚠️ User has no role_id assigned");
      }

      // Fetch user departments
      const departments = await profileService.fetchUserDepartments(sysUserId);

      const responseData = {
        sys_user_id: userRow.sys_user_id,
        sys_user_email: userRow.sys_user_email,
        role_id: userRow.role_id,
        role_name: userRow.role?.role_name || null,
        privilege: privileges, // Add privileges to the response
        departments: departments, // Add departments to the response
        profile: profRow,
        image,
      };

      res.json({ data: responseData });
    } catch (err) {
      console.error("Error fetching profile:", err.message);
      
      if (err.message === "User not found") {
        return res.status(404).json({ error: err.message });
      }
      
      res.status(500).json({ error: "Server error fetching profile" });
    }
  }

  /**
   * Update current user profile
   */
  async updateCurrentUserProfile(req, res) {
    try {
      const sysUserId = req.userId;
      const { firstName, middleName, lastName, email, address, dateOfBirth } = req.body;

      const profId = await profileService.getProfileId(sysUserId);

      // Update email if provided
      if (email !== undefined) {
        await profileService.updateUserEmail(sysUserId, email);
      }

      // Update profile fields
      await profileService.updateProfile(profId, {
        firstName,
        middleName,
        lastName,
        address,
        dateOfBirth,
      });

      res.json({ data: { message: "Profile updated successfully" } });
    } catch (err) {
      console.error("Error updating profile:", err.message);
      
      if (err.message === "User not found") {
        return res.status(404).json({ error: err.message });
      }
      
      res.status(500).json({ error: "Server error updating profile" });
    }
  }

  /**
   * Upload profile image
   */
  async uploadProfileImage(req, res) {
    try {
      const sysUserId = req.userId;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "No image uploaded" });
      }

      const profId = await profileService.getProfileId(sysUserId);

      // Upload file to storage
      const publicUrl = await profileService.uploadImageToStorage(profId, file);

      // Unset previous current images
      await profileService.unsetPreviousCurrentImages(profId);

      // Insert new image as current
      const inserted = await profileService.insertProfileImage(profId, publicUrl);

      res.json({ data: {
        message: "Image uploaded successfully",
        img_location: publicUrl,
        image: inserted,
      } });
    } catch (err) {
      console.error("Error uploading profile image:", err.message);
      
      if (err.message === "User not found") {
        return res.status(404).json({ error: err.message });
      }
      
      res.status(500).json({ error: "Server error uploading image" });
    }
  }

  /**
   * Get agent status
   */
  async getAgentStatus(req, res) {
    try {
      const sysUserId = req.userId;

      const agentStatus = await profileService.getAgentStatus(sysUserId);

      res.json({ data: {
        agent_status: agentStatus
      } });
    } catch (err) {
      console.error("Error fetching agent status:", err.message);
      
      if (err.message === "User not found") {
        return res.status(404).json({ error: err.message });
      }
      
      res.status(500).json({ error: "Server error fetching agent status" });
    }
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(req, res) {
    try {
      const sysUserId = req.userId;
      const { agent_status } = req.body;

      if (!agent_status) {
        return res.status(400).json({ error: "agent_status is required" });
      }

      // Update via service
      await profileService.updateAgentStatus(sysUserId, agent_status);

      // Broadcast via socket if available
      const io = req.app.get('io');
      if (io) {
        const { broadcastStatusChangeToDepartments } = require("../socket-simple/agent-status");
        await broadcastStatusChangeToDepartments(io, sysUserId, agent_status, "agent", new Date());
        console.log(`📡 Broadcasted agent status change via REST API: ${agent_status}`);
      }

      res.json({ data: {
        message: "Agent status updated successfully",
        agent_status
      } });
    } catch (err) {
      console.error("Error updating agent status:", err.message);
      
      if (err.message === "User not found") {
        return res.status(404).json({ error: err.message });
      }
      
      if (err.message.includes("Invalid agent status")) {
        return res.status(400).json({ error: err.message });
      }
      
      res.status(500).json({ error: "Server error updating agent status" });
    }
  }
}

module.exports = new ProfileController();
