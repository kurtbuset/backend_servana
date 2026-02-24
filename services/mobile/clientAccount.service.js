const supabase = require("../../helpers/supabaseClient");
const { v4: uuidv4 } = require("uuid");
const jwtUtils = require("../../utils/jwt");

const OTP_LENGTH = 6;

class ClientAccountService {
  /**
   * Get the Client role ID dynamically
   */
  async getClientRoleId() {
    const { data, error } = await supabase
      .from("role")
      .select("role_id")
      .eq("role_name", "Client")
      .single();

    if (error || !data) {
      throw new Error("Client role not found in database");
    }

    return data.role_id;
  }

  /**
   * Generate OTP
   */
  generateOtp(length = OTP_LENGTH) {
    let otp = "";
    for (let i = 0; i < length; i++) otp += Math.floor(Math.random() * 10);
    return otp;
  }

  /**
   * Check if OTP already exists and is verified
   * Also checks rate limiting (3 requests per hour)
   */
  async checkExistingOtp(phoneCountryCode, phoneNumber) {
    const { data, error } = await supabase
      .from("otp_sms")
      .select("*")
      .eq("phone_country_code", phoneCountryCode)
      .eq("phone_number", phoneNumber)
      .eq("verified", true)
      .single();

    return { data, error };
  }

  /**
   * Check rate limiting for OTP requests
   * Returns the count of OTP requests in the last hour
   */
  async checkRateLimit(phoneCountryCode, phoneNumber) {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

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
   * Create profile
   */
  async createProfile(firstName, lastName, birthdate, address) {
    const { data, error } = await supabase
      .from("profile")
      .insert({
        prof_firstname: firstName,
        prof_lastname: lastName,
        prof_date_of_birth: birthdate,
        prof_address: address || null,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error("Failed to create profile");
    }

    return data;
  }

  /**
   * Create minimal profile (firstname and lastname only)
   * Used for optional profile completion in passwordless auth
   */
  async createProfileMinimal(firstName, lastName) {
    const { data, error } = await supabase
      .from("profile")
      .insert({
        prof_firstname: firstName,
        prof_lastname: lastName,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error("Failed to create profile");
    }

    return data;
  }

  /**
   * Link profile to client
   */
  async linkProfileToClient(clientId, profId) {
    const { error } = await supabase
      .from("client")
      .update({ prof_id: profId })
      .eq("client_id", clientId);

    if (error) {
      throw new Error("Failed to link profile to client");
    }
  }

  /**
   * Create client
   */
  async createClient(phoneCountryCode, phoneNumber, profId) {
    const clientRoleId = await this.getClientRoleId();

    const { data, error } = await supabase
      .from("client")
      .insert({
        client_country_code: phoneCountryCode,
        client_number: phoneNumber,
        prof_id: profId,
        client_updated_at: new Date().toISOString(),
        client_is_active: true,
        client_is_verified: true,
        role_id: clientRoleId,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error("Failed to create client");
    }

    return data;
  }

  /**
   * Delete OTP
   */
  async deleteOtp(otpId) {
    await supabase
      .from("otp_sms")
      .delete()
      .eq("otp_id", otpId);
  }

  /**
   * Get client by phone number
   */
  async getClientByPhone(phoneCountryCode, phoneNumber) {
    const { data, error } = await supabase
      .from("client")
      .select(
        `
        *,
        prof_id (
          prof_id,
          prof_firstname,
          prof_middlename,
          prof_lastname,
          prof_address,
          prof_date_of_birth,
          prof_street_address,
          prof_region_info,
          prof_postal_code
        )
      `,
      )
      .eq("client_country_code", phoneCountryCode)
      .eq("client_number", phoneNumber)
      .single();

    if (error || !data) {
      throw new Error("Client not found");
    }

    return data;
  }
  /**
   * Check if client exists by phone number (without password check)
   */
  async checkClientExists(phoneCountryCode, phoneNumber) {
    const { data, error } = await supabase
      .from("client")
      .select("client_id")
      .eq("client_country_code", phoneCountryCode)
      .eq("client_number", phoneNumber)
      .single();

    return { exists: !!data, clientId: data?.client_id || null };
  }

  /**
   * Generate JWT token
   */
  generateToken(clientId, clientNumber) {
    return jwtUtils.generateAccessToken({
      client_id: clientId,
      client_number: clientNumber,
    });
  }

  /**
   * Generate long-lived JWT token (30 days)
   * Used for passwordless authentication
   */
  generateLongLivedToken(clientId, clientNumber) {
    const jwt = require("jsonwebtoken");
    const config = require("../../config/app");

    return jwt.sign(
      {
        client_id: clientId,
        client_number: clientNumber,
        type: "client",
      },
      config.jwt.accessSecret,
      { expiresIn: "30d" },
    );
  }

  /**
   * Create client without password (for passwordless auth)
   */
  async createClientWithoutPassword(phoneCountryCode, phoneNumber) {
    const clientRoleId = await this.getClientRoleId();

    const { data, error } = await supabase
      .from("client")
      .insert({
        client_country_code: phoneCountryCode,
        client_number: phoneNumber,
        prof_id: null, // No profile yet
        client_updated_at: new Date().toISOString(),
        client_is_active: true,
        role_id: clientRoleId,
      })
      .select(
        `
        *,
        prof_id (
          prof_id,
          prof_firstname,
          prof_middlename,
          prof_lastname,
          prof_address,
          prof_date_of_birth,
          prof_street_address,
          prof_region_info,
          prof_postal_code
        )
      `,
      )
      .single();

    if (error || !data) {
      throw new Error("Failed to create client");
    }

    return data;
  }

  /**
   * Get or create chat group
   */
  async getOrCreateChatGroup(clientId) {
    // Check if chat group exists
    const { data: existingGroup } = await supabase
      .from("chat_group")
      .select("chat_group_id")
      .eq("client_id", clientId)
      .order("chat_group_id", { ascending: false })
      .limit(1)
      .single();

    if (existingGroup) {
      return existingGroup.chat_group_id;
    }

    // Create new chat group
    const { data: newGroup, error: createError } = await supabase
      .from("chat_group")
      .insert([{ client_id: clientId, dept_id: null }])
      .select("chat_group_id")
      .single();

    if (createError) {
      throw new Error("Failed to create chat group");
    }

    return newGroup.chat_group_id;
  }

  /**
   * Update chat group department
   */
  async updateChatGroupDepartment(chatGroupId, deptId) {
    const { data, error } = await supabase
      .from("chat_group")
      .update({ dept_id: deptId })
      .eq("chat_group_id", chatGroupId)
      .select();

    if (error || !data || data.length === 0) {
      throw new Error("Failed to assign department");
    }

    return data[0];
  }

  /**
   * Get department name
   */
  async getDepartmentName(deptId) {
    const { data, error } = await supabase
      .from("department")
      .select("dept_name")
      .eq("dept_id", deptId)
      .single();

    if (error || !data) {
      throw new Error("Failed to fetch department name");
    }

    return data.dept_name;
  }

  /**
   * Insert initial chat message
   */
  async insertInitialMessage(chatGroupId, deptName) {
    const { error } = await supabase.from("chat").insert([
      {
        chat_group_id: chatGroupId,
        chat_body: deptName,
        sender: "system",
        chat_created_at: new Date().toISOString(),
      },
    ]);

    if (error) {
      throw new Error("Failed to insert initial message");
    }
  }

  /**
   * Update profile
   */
  async updateProfile(profId, profileData) {
    const { data, error } = await supabase
      .from("profile")
      .update(profileData)
      .eq("prof_id", profId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Send client message
   */
  async sendClientMessage(message, clientId, deptId) {
    // Check if chat group exists
    let { data: chatGroups, error: groupErr } = await supabase
      .from("chat_group")
      .select("*")
      .eq("client_id", clientId);

    if (groupErr) throw groupErr;

    let chatGroupId;
    if (!chatGroups || chatGroups.length === 0) {
      // Create new chat group
      const { data: newGroup, error: createErr } = await supabase
        .from("chat_group")
        .insert([{ client_id: clientId, dept_id: deptId }])
        .select("*")
        .single();

      if (createErr) throw createErr;
      chatGroupId = newGroup.chat_group_id;
    } else {
      chatGroupId = chatGroups[0].chat_group_id;
    }

    // Insert message
    const { data, error: insertErr } = await supabase
      .from("chat")
      .insert([
        {
          chat_group_id: chatGroupId,
          client_id: clientId,
          sys_user_id: null,
          chat_body: message,
        },
      ])
      .select("*");

    if (insertErr) throw insertErr;
    return data[0];
  }
}

module.exports = new ClientAccountService();
