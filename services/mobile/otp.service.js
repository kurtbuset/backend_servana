const crypto = require("crypto");
const supabase = require("../../helpers/supabaseClient");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_LIMIT_COUNT = 3;
const OTP_RATE_LIMIT_HOURS = 1;

class OtpService {
  /**
   * Generate OTP
   */
  generateOtp(length = OTP_LENGTH) {
    let otp = "";
    for (let i = 0; i < length; i++) otp += crypto.randomInt(0, 10);
    return otp;
  }

  /**
   * Hash OTP using bcrypt
   */
  async hashOtp(otp) {
    return await bcrypt.hash(otp, 10);
  }

  /**
   * Verify OTP against hash
   */
  async verifyOtp(otp, otpHash) {
    return await bcrypt.compare(otp, otpHash);
  }

  /**
   * Calculate OTP expiry timestamp
   */
  getOtpExpiryTimestamp() {
    return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
  }

  /**
   * Check rate limiting for OTP requests
   * Returns the count of OTP requests in the last hour
   */
  async checkRateLimit(phoneCountryCode, phoneNumber) {
    const oneHourAgo = new Date(
      Date.now() - OTP_RATE_LIMIT_HOURS * 3600000,
    ).toISOString();

    const { data, error } = await supabase
      .from("otp_sms")
      .select("created_at")
      .eq("phone_country_code", phoneCountryCode)
      .eq("phone_number", phoneNumber)
      .gte("created_at", oneHourAgo);

    if (error) {
      throw new Error("Failed to check rate limit");
    }

    return data ? data.length : 0;
  }

  /**
   * Validate rate limit  
   * Throws error if rate limit exceeded
   */
  async validateRateLimit(phoneCountryCode, phoneNumber) {
    const count = await this.checkRateLimit(phoneCountryCode, phoneNumber);
    if (count >= OTP_RATE_LIMIT_COUNT) {
      throw new Error(
        `Too many OTP requests. Please try again in ${OTP_RATE_LIMIT_HOURS} hour.`,
      );
    }
  }

  /**
   * Upsert OTP
   * @param {string} phoneCountryCode - Phone country code
   * @param {string} phoneNumber - Phone number
   * @param {string} otpHash - Hashed OTP
   * @param {string} expiresAt - Expiration timestamp
   * @param {string} otpType - Type of OTP ('registration' or 'login')
   * @param {number|null} clientId - Client ID (for login OTPs)
   */
  async upsertOtp(
    phoneCountryCode,
    phoneNumber,
    otpHash,
    expiresAt,
    otpType = "registration",
    clientId = null,
  ) {
    const { error } = await supabase.from("otp_sms").upsert(
      {
        otp_id: uuidv4(),
        phone_country_code: phoneCountryCode,
        phone_number: phoneNumber,
        otp_hash: otpHash,
        expires_at: expiresAt,
        otp_type: otpType,
        client_id: clientId,
        verified: false,
        attempts: 0,
      },
      { onConflict: ["phone_number"] },
    );

    if (error) throw error;
  }

  /**
   * Get OTP data
   * Returns all OTP fields including otp_type and client_id
   */
  async getOtpData(phoneCountryCode, phoneNumber) {
    const { data, error } = await supabase
      .from("otp_sms")
      .select("*")
      .eq("phone_country_code", phoneCountryCode)
      .eq("phone_number", phoneNumber)
      .single();

    if (error || !data) {
      throw new Error("OTP not found");
    }

    return data;
  }

  /**
   * Validate OTP data (expiry, attempts, verification status)
   * Throws specific errors for different validation failures
   */
  async validateOtpData(otpData) {
    if (otpData.verified) {
      throw new Error("OTP already used");
    }

    if (new Date() > new Date(otpData.expires_at)) {
      throw new Error("OTP expired");
    }

    if (otpData.attempts >= OTP_MAX_ATTEMPTS) {
      throw new Error(
        "Too many failed attempts. Please request a new OTP.",
      );
    }
  }

  /**
   * Increment OTP attempts
   */
  async incrementOtpAttempts(otpId, currentAttempts) {
    await supabase
      .from("otp_sms")
      .update({ attempts: currentAttempts + 1 })
      .eq("otp_id", otpId);
  }

  /**
   * Mark OTP as verified
   */
  async markOtpAsVerified(otpId) {
    await supabase
      .from("otp_sms")
      .update({ verified: true })
      .eq("otp_id", otpId);
  }


  /**
   * Delete OTP
   */
  async deleteOtp(otpId) {
    await supabase.from("otp_sms").delete().eq("otp_id", otpId);
  }

  /**
   * REQUEST OTP - Main business logic
   * Handles both login and registration flows
   */
  async requestOtpFlow(phoneCountryCode, phoneNumber, clientExists, clientId = null) {
    // 1. Validate rate limit
    await this.validateRateLimit(phoneCountryCode, phoneNumber);

    // 2. Determine OTP type
    const isNewUser = !clientExists;
    const otpType = isNewUser ? "registration" : "login";

    // 3. Generate and hash OTP
    const otp = this.generateOtp(6);
    const otpHash = await this.hashOtp(otp);
    const expiresAt = this.getOtpExpiryTimestamp();

    // for development
    // console.log('otp: ', otp)
    // 4. Store OTP
    await this.upsertOtp(
      phoneCountryCode,
      phoneNumber,
      otpHash,
      expiresAt,
      otpType,
      clientId,
    );

    // 5. Return metadata including OTP for SMS delivery
    return {
      otp,
      isNewUser,
      expiresIn: OTP_EXPIRY_MINUTES * 60,
    };
  }

  /**
   * VERIFY OTP - Main business logic
   * Handles OTP verification
   */
  async verifyOtpFlow(phoneCountryCode, phoneNumber, otp) {
    // 1. Get OTP data
    const otpData = await this.getOtpData(phoneCountryCode, phoneNumber);

    // 2. Validate OTP data (expiry, attempts, verification status)
    await this.validateOtpData(otpData);

    // 3. Verify OTP
    const isValid = await this.verifyOtp(otp, otpData.otp_hash);

    if (!isValid) {
      // Increment attempts on failure
      await this.incrementOtpAttempts(otpData.otp_id, otpData.attempts);
      throw new Error(
        `Invalid OTP. ${OTP_MAX_ATTEMPTS - (otpData.attempts + 1)} attempts remaining.`,
      );
    }

    // 4. Delete OTP after successful verification
    await this.deleteOtp(otpData.otp_id);

    // 5. Return OTP data for further processing
    return {
      otpType: otpData.otp_type,
      clientId: otpData.client_id,
    };
  }
}

module.exports = new OtpService();
