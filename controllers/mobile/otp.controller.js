const express = require("express");
const rateLimit = require("express-rate-limit");
const otpService = require("../../services/mobile/otp.service");
const clientAccountService = require("../../services/mobile/clientAccount.service");
const smsService = require("../../services/sms.service");

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 OTP requests per window
  message: { error: "Too many OTP requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

class OtpController {
  getRouter() {
    const router = express.Router();

    // Public routes (no authentication required)
    router.post("/request-otp", otpLimiter, (req, res) => this.requestOtp(req, res));
    router.post("/verify-otp", otpLimiter, (req, res) => this.verifyOtp(req, res));

    // Global error handler
    router.use((err, req, res, next) => {
      console.error("Unhandled error:", err);
      res
        .status(500)
        .json({ error: "Internal server error" });
    });

    return router;
  }

  /**
   * Request OTP (Unified for Login/Registration)
   */
  async requestOtp(req, res) {
    try {
      const { phone_country_code, phone_number } = req.body;

      // Validate input
      if (!phone_country_code || !phone_number) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      // Check if client exists
      const { exists, clientId } = await clientAccountService.checkClientExists(
        phone_country_code,
        phone_number,
      );

      // Call OTP service
      const result = await otpService.requestOtpFlow(
        phone_country_code,
        phone_number,
        exists,
        clientId,
      );

      // Send OTP via SMS
      // if (process.env.SMS_TO_API_KEY) {
      //   try {
      //     await smsService.sendOtpSms(phone_country_code, phone_number, result.otp);
      //   } catch (smsError) {
      //     console.error('Failed to send SMS:', smsError.message);
          
      //     // If it's a balance issue, log OTP to console for development
      //     if (smsError.message?.includes('SMS_BALANCE_REQUIRED')) {
      //       console.log(`⚠️  SMS.to requires account top-up. Development OTP for ${phone_country_code}${phone_number}: ${result.otp}`);
      //     }
      //     // Continue even if SMS fails - OTP is still stored
      //   }
      // } else {
      //   // Development mode - log OTP to console
      //   console.log(`🔐 OTP for ${phone_country_code}${phone_number}: ${result.otp}`);
      // }

      res.json({ data: {  
        message: "OTP sent successfully",
        is_new_user: result.isNewUser,
        otp_expires_in: result.expiresIn,
      } });
    } catch (err) {
      console.error("Request OTP error:", err);

      if (err.message.includes("Too many OTP requests")) {
        return res.status(429).json({ error: err.message });
      }

      res.status(500).json({ error: "Failed to send OTP" });
    }
  }

  /**
   * Verify OTP (Unified for Login/Registration)
   */
  async verifyOtp(req, res) {
    try {
      const { phone_country_code, phone_number, otp } = req.body;

      // Validate input
      if (!phone_country_code || !phone_number || !otp) {
        return res
          .status(400)
          .json({ error: "Phone number and OTP are required" });
      }

      // Verify OTP
      const otpResult = await otpService.verifyOtpFlow(
        phone_country_code,
        phone_number,
        otp,
      );

      // Get or create client based on OTP type
      let client;
      let isNewUser = false;

      if (otpResult.otpType === "registration") {
        client = await clientAccountService.createClientWithoutPassword(
          phone_country_code,
          phone_number,
        );
        isNewUser = true;
      } else {
        client = await clientAccountService.getClientByPhone(
          phone_country_code,
          phone_number,
        );
      }

      // Generate JWT token
      const token = clientAccountService.generateLongLivedToken(
        client.client_id,
        client.client_number,
      );

      res.json({ data: {
        message: "Authenticated successfully",
        is_new_user: isNewUser,
        requires_profile: !client.prof_id,
        token,
        client: {
          client_id: client.client_id,
          client_number: client.client_number,
          client_country_code: client.client_country_code,
          prof_id: client.prof_id,
        },
      } });
    } catch (err) {
      console.error("Verify OTP error:", err);

      if (err.message === "OTP not found") {
        return res.status(404).json({ error: err.message });
      }

      if (err.message.includes("Invalid OTP")) {
        return res.status(400).json({ error: err.message });
      }

      if (
        err.message === "OTP already used" ||
        err.message === "OTP expired" ||
        err.message.includes("Too many failed attempts")
      ) {
        return res.status(400).json({ error: err.message });
      }

      res.status(500).json({ error: "Failed to verify OTP" });
    }
  }
}

module.exports = new OtpController();
