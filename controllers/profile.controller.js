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

    return router;  
  }
  /**
   * Get current user profile
   */
  async getCurrentUserProfile(req, res) {
    try {
      const sysUserId = req.userId;

      // Fetch all data in parallel for better performance
      const [
        { userRow, profRow },
        departments
      ] = await Promise.all([
        profileService.fetchUserAndProfile(sysUserId),
        profileService.fetchUserDepartments(sysUserId)
      ]);

      // Fetch image and privileges in parallel (only if needed)
      const [image, privileges] = await Promise.all([
        profRow?.prof_id ? profileService.fetchCurrentImage(profRow.prof_id) : Promise.resolve(null),
        userRow.role_id ? profileService.fetchUserPrivileges(userRow.role_id) : Promise.resolve(null)
      ]);

      const responseData = {
        sys_user_id: userRow.sys_user_id,
        sys_user_email: userRow.sys_user_email,
        role_id: userRow.role_id,
        role_name: userRow.role?.role_name || null,
        privilege: privileges,
        departments: departments,
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
}

module.exports = new ProfileController();
