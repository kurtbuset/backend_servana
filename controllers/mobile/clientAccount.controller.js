const express = require("express");
const clientAccountService = require("../../services/mobile/clientAccount.service");
const bcrypt = require("bcrypt");
const getCurrentMobileUser = require("../../middleware/getCurrentMobileUser");
const supabase = require("../../helpers/supabaseClient");

class ClientAccountController {
  getRouter() {
    const router = express.Router();

    // Public routes (no authentication required)
    router.post("/auth/request-otp", (req, res) => this.requestOtp(req, res));
    router.post("/auth/send-otp", (req, res) => this.sendOtp(req, res));
    router.post("/auth/verify-otp", (req, res) => this.verifyOtp(req, res));

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
   * Request OTP (Unified for Login/Registration)
   */
  async requestOtp(req, res) {
    try {
      const { phone_country_code, phone_number } = req.body;

      // 1. Validate input
      if (!phone_country_code || !phone_number) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      // 2. Rate limiting check (3 requests per hour)
      const rateLimitCount = await clientAccountService.checkRateLimit(
        phone_country_code,
        phone_number,
      );

      if (rateLimitCount >= 3) {
        return res.status(429).json({
          error: "Too many OTP requests. Please try again in 1 hour.",
        });
      }

      // 3. Check if client exists
      const { exists, clientId } = await clientAccountService.checkClientExists(
        phone_country_code,
        phone_number,
      );

      const isNewUser = !exists;
      const otpType = isNewUser ? "registration" : "login";

      // 4. Generate OTP
      const otp = clientAccountService.generateOtp(6);
      console.log(`🔐 OTP for ${phone_country_code}${phone_number}: ${otp}`);

      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      // 5. Store OTP (upsert to replace any existing OTP)
      await clientAccountService.upsertOtp(
        phone_country_code,
        phone_number,
        otpHash,
        expiresAt,
        otpType,
        clientId,
      );

      // 6. Send SMS (TODO: Replace with actual SMS gateway)
      // await smsGateway.send(
      //   phone_country_code + phone_number,
      //   `Your verification code is: ${otp}`
      // );

      res.json({
        message: "OTP sent successfully",
        is_new_user: isNewUser,
        otp_expires_in: 300,
      });
    } catch (err) {
      console.error("Send OTP error:", err);
      res.status(500).json({ error: "Failed to send OTP" });
    }
  }

  /**
   * Verify OTP (Unified for Login/Registration)
   */
  async verifyOtp(req, res) {
    try {
      const { phone_country_code, phone_number, otp } = req.body;

      // 1. Validate input (phone + OTP)
      if (!phone_country_code || !phone_number || !otp) {
        return res
          .status(400)
          .json({ error: "Phone number and OTP are required" });
      }

      // 2. Get OTP data from database
      const otpData = await clientAccountService.getOtpData(
        phone_country_code,
        phone_number,
      );

      // 3. Check if OTP already verified
      if (otpData.verified) {
        return res.status(400).json({ error: "OTP already used" });
      }

      // 4. Check if OTP expired (5 minutes)
      if (new Date() > new Date(otpData.expires_at)) {
        return res.status(400).json({ error: "OTP expired" });
      }

      // 5. Check attempt limit (5 attempts)
      if (otpData.attempts >= 5) {
        return res.status(400).json({
          error: "Too many failed attempts. Please request a new OTP.",
        });
      }

      // 6. Verify OTP with bcrypt
      const isValid = await bcrypt.compare(otp, otpData.otp_hash);

      // 7. Increment attempts on failure
      if (!isValid) {
        await clientAccountService.incrementOtpAttempts(
          otpData.otp_id,
          otpData.attempts,
        );
        return res.status(400).json({
          error: "Invalid OTP",
          attempts_remaining: 5 - (otpData.attempts + 1),
        });
      }

      // 8. Create new client if registration OR get existing client if login
      let client;
      let isNewUser = false;

      if (otpData.otp_type === "registration") {
        // Create new client (no password, no profile yet)
        client = await clientAccountService.createClientWithoutPassword(
          phone_country_code,
          phone_number,
        );
        isNewUser = true;
      } else {
        // Get existing client
        client = await clientAccountService.getClientByPhone(
          phone_country_code,
          phone_number,
        );
      }

      // 9. Generate JWT token (30-day expiry)
      const token = clientAccountService.generateLongLivedToken(
        client.client_id,
        client.client_number,
      );

      // 10. Delete OTP after successful verification
      await clientAccountService.deleteOtp(otpData.otp_id);

      // 11. Return token + client data + `requires_profile` flag
      res.json({
        message: "Authenticated successfully",
        is_new_user: isNewUser,
        requires_profile: !client.prof_id,
        token,
        client,
      });
    } catch (err) {
      console.error("Verify OTP error:", err);

      if (err.message === "OTP not found") {
        return res.status(404).json({ error: err.message });
      }

      res.status(500).json({ error: "Failed to verify OTP" });
    }
  }

  /**
   * Validate Token
   * Validates the JWT token and checks if the client still exists in the database
   * Used on app initialization to ensure the user account is still valid
   */
  async validateToken(req, res) {
    try {
      const clientId = req.userId; // From getCurrentMobileUser middleware

      // Token is already validated by middleware (JWT signature + expiration)
      // Now check if client still exists in database
      const { data: client, error: clientError } = await supabase
        .from("client")
        .select(
          `
          client_id,
          client_country_code,
          client_number,
          client_is_active,
          prof_id (
            prof_id,
            prof_firstname,
            prof_lastname,
            prof_middlename
          )
        `,
        )
        .eq("client_id", clientId)
        .single();

      if (clientError || !client) {
        return res.status(404).json({ error: "Client not found" });
      }

      // Check if client is active
      if (!client.client_is_active) {
        return res.status(403).json({ error: "Account is inactive" });
      }

      // Return client data
      res.json({
        message: "Token is valid",
        client,
      });
    } catch (err) {
      console.error("Validate token error:", err);
      res.status(500).json({ error: "Failed to validate token" });
    }
  }

  /**
   * Complete Profile (Optional)
   * Allows users to add/update their profile information after authentication
   */
  async completeProfile(req, res) {
    try {
      const clientId = req.userId; // From getCurrentMobileUser middleware
      const { firstname, lastname } = req.body;

      // 1. Validate JWT token (already done by middleware)
      if (!clientId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // 2. Get client
      const { data: client, error: clientError } = await supabase
        .from("client")
        .select("prof_id")
        .eq("client_id", clientId)
        .single();

      if (clientError || !client) {
        return res.status(404).json({ error: "Client not found" });
      }

      // 3. Create or update profile
      let profile;

      if (client.prof_id) {
        // Update existing profile
        profile = await clientAccountService.updateProfile(client.prof_id, {
          prof_firstname: firstname,
          prof_lastname: lastname,
        });
      } else {
        // Create new profile
        profile = await clientAccountService.createProfileMinimal(
          firstname,
          lastname,
        );

        // Link profile to client
        await clientAccountService.linkProfileToClient(
          clientId,
          profile.prof_id,
        );
      }

      // 4. Return profile data
      res.json({
        message: client.prof_id
          ? "Profile updated successfully"
          : "Profile created successfully",
        profile,
      });
    } catch (err) {
      console.error("Complete profile error:", err);
      res.status(500).json({ error: "Failed to update profile" });
    }
  }

  /**
   * Send OTP (Old endpoint - kept for backward compatibility)
   */
  async sendOtp(req, res) {
    try {
      const { phone_country_code, phone_number, otp } = req.body;

      if (!phone_country_code || !phone_number || !otp) {
        return res
          .status(400)
          .json({ error: "Phone number and OTP are required" });
      }

      const otpData = await clientAccountService.getOtpData(
        phone_country_code,
        phone_number,
      );

      if (otpData.verified) {
        return res.status(400).json({ error: "OTP already verified" });
      }

      if (new Date() > new Date(otpData.expires_at)) {
        return res.status(400).json({ error: "OTP expired" });
      }

      const isValid = await bcrypt.compare(otp, otpData.otp_hash);

      if (!isValid) {
        await clientAccountService.incrementOtpAttempts(
          otpData.otp_id,
          otpData.attempts,
        );
        return res.status(400).json({ error: "Invalid OTP" });
      }

      // Mark OTP as verified
      await clientAccountService.markOtpAsVerified(otpData.otp_id);

      res.status(200).json({ message: "OTP verified successfully" });
    } catch (err) {
      console.error("Verify OTP error:", err);

      if (err.message === "OTP not found") {
        return res.status(404).json({ error: err.message });
      }

      res.status(500).json({ error: "Failed to verify OTP" });
    }
  }

  /**
   * Set chat group department
   */
  async setChatGroupDepartment(req, res) {
    try {
      const id = Number(req.params.id);
      const { dept_id } = req.body;

      if (!dept_id) {
        return res.status(400).json({ error: "Department ID is required" });
      }

      // Update chat_group
      const updatedGroup = await clientAccountService.updateChatGroupDepartment(
        id,
        dept_id,
      );

      // Get department name
      const deptName = await clientAccountService.getDepartmentName(dept_id);

      // Insert initial message
      await clientAccountService.insertInitialMessage(id, deptName);

      res.status(200).json({
        message: "Department assigned successfully and message created",
        updated: updatedGroup,
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

      if (!prof_firstname || !prof_lastname) {
        return res
          .status(400)
          .json({ message: "First name and last name are required" });
      }

      const data = await clientAccountService.updateProfile(prof_id, {
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
        profile: data,
      });
    } catch (err) {
      console.error("Update profile error:", err);
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  }

  /**
   * Send client message
   */
  async sendClientMessage(req, res) {
    try {
      const { message, clientId, deptId } = req.body;

      if (!message || !clientId) {
        return res.status(400).json({ error: "Missing message or clientId" });
      }

      const data = await clientAccountService.sendClientMessage(
        message,
        clientId,
        deptId,
      );

      res.json({ success: true, message: data });
    } catch (err) {
      console.error("❌ Error sending client message:", err);
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new ClientAccountController();
