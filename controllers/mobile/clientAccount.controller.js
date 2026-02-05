const express = require("express");
const clientAccountService = require("../../services/mobile/clientAccount.service");
const bcrypt = require("bcrypt");
const getCurrentMobileUser = require("../../middleware/getCurrentMobileUser");

class ClientAccountController {
  getRouter() {
    const router = express.Router();

    // Public routes (no authentication required)
    router.post("/auth/send-otp", (req, res) => this.sendOtp(req, res));
    router.post("/auth/verify-otp", (req, res) => this.verifyOtp(req, res));
    router.post("/auth/complete-registration", (req, res) => this.completeRegistration(req, res));
    router.post("/logincl", (req, res) => this.loginClient(req, res));

    // Protected routes (authentication required)
    router.patch("/chat_group/:id/set-department", getCurrentMobileUser, (req, res) => this.setChatGroupDepartment(req, res));
    router.put("/:prof_id", getCurrentMobileUser, (req, res) => this.updateProfile(req, res));
    router.post("/client", getCurrentMobileUser, (req, res) => this.sendClientMessage(req, res));

    // Global error handler
    router.use((err, req, res, next) => {
      console.error("Unhandled error:", err);
      res.status(500).json({ error: "Internal server error", details: String(err) });
    });

    return router;
  }
  /**
   * Send OTP
   */
  async sendOtp(req, res) {
    try {
      const { phone_country_code, phone_number } = req.body;

      if (!phone_country_code || !phone_number) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      // Check if OTP already exists and is verified
      const { data: existingOtp } = await clientAccountService.checkExistingOtp(
        phone_country_code,
        phone_number
      );

      if (existingOtp) {
        return res.status(409).json({
          error: "An OTP has already been sent to this number. Please wait or use the existing OTP.",
        });
      }

      // Generate and hash OTP
      const otp = clientAccountService.generateOtp();
      console.log(`🔐 Generated OTP for ${phone_country_code}${phone_number}: ${otp}`);
      const otp_hash = await bcrypt.hash(otp, 10);
      const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      // Upsert OTP
      await clientAccountService.upsertOtp(phone_country_code, phone_number, otp_hash, expires_at);

      // TODO: Replace with actual SMS sending

      res.status(200).json({ message: "OTP sent successfully" });
    } catch (err) {
      console.error("Send OTP error:", err);
      res.status(500).json({ error: "Failed to send OTP" });
    }
  }

  /**
   * Verify OTP
   */
  async verifyOtp(req, res) {
    try {
      const { phone_country_code, phone_number, otp } = req.body;

      if (!phone_country_code || !phone_number || !otp) {
        return res.status(400).json({ error: "Phone number and OTP are required" });
      }

      const otpData = await clientAccountService.getOtpData(phone_country_code, phone_number);

      if (otpData.verified) {
        return res.status(400).json({ error: "OTP already verified" });
      }

      if (new Date() > new Date(otpData.expires_at)) {
        return res.status(400).json({ error: "OTP expired" });
      }

      const isValid = await bcrypt.compare(otp, otpData.otp_hash);

      if (!isValid) {
        await clientAccountService.incrementOtpAttempts(otpData.otp_id, otpData.attempts);
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
   * Complete registration
   */
  async completeRegistration(req, res) {
    try {
      const { phone_country_code, phone_number, firstName, lastName, birthdate, address, password } =
        req.body;

      if (!phone_country_code || !phone_number || !firstName || !lastName || !birthdate || !password) {
        return res.status(400).json({ error: "All fields are required" });
      }

      // Check that OTP was verified
      const otpData = await clientAccountService.getOtpData(phone_country_code, phone_number);

      if (!otpData.verified) {
        return res.status(400).json({ error: "OTP not verified yet" });
      }

      // Create profile
      const profileData = await clientAccountService.createProfile(
        firstName,
        lastName,
        birthdate,
        address
      );

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create client
      const clientData = await clientAccountService.createClient(
        phone_country_code,
        phone_number,
        hashedPassword,
        profileData.prof_id
      );

      // Delete OTP
      await clientAccountService.deleteOtp(otpData.otp_id);

      // Generate JWT token
      const token = clientAccountService.generateToken(clientData.client_id, clientData.client_number);

      res.status(200).json({
        message: "Account created successfully",
        client: {
          ...clientData,
          prof_id: profileData,
        },
        token,
      });
    } catch (err) {
      console.error("Complete registration error:", err);
      res.status(500).json({ error: err.message || "Failed to complete registration" });
    }
  }

  /**
   * Login client
   */
  async loginClient(req, res) {
    try {
      const { client_country_code, client_number, client_password } = req.body;

      if (!client_country_code || !client_number || !client_password) {
        return res.status(400).json({ error: "All fields are required" });
      }

      // Get client
      const client = await clientAccountService.getClientByPhone(client_country_code, client_number);

      // Check password
      const isMatch = await bcrypt.compare(client_password, client.client_password);

      if (!isMatch) {
        return res.status(401).json({ error: "Invalid phone number or password" });
      }

      // Generate JWT
      const token = clientAccountService.generateToken(client.client_id, client.client_number);

      // Get or create chat group
      // const chatGroupId = await clientAccountService.getOrCreateChatGroup(client.client_id);

      res.status(200).json({
        message: "Login successful",
        client,
        token,
        // chat_group_id: chatGroupId,
        chat_group_name: `Client ${client.client_id} Chat`,
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(401).json({ error: err.message });
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
      const updatedGroup = await clientAccountService.updateChatGroupDepartment(id, dept_id);

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
        return res.status(400).json({ message: "First name and last name are required" });
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

      const data = await clientAccountService.sendClientMessage(message, clientId, deptId);

      res.json({ success: true, message: data });
    } catch (err) {
      console.error("❌ Error sending client message:", err);
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new ClientAccountController();
