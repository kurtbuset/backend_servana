const supabase = require("../../helpers/supabaseClient");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || "your_jwt_secret_key";
const OTP_LENGTH = 6;
const OTP_EXPIRATION_MINUTES = 5;

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
   * Upsert OTP
   */
  async upsertOtp(phoneCountryCode, phoneNumber, otpHash, expiresAt) {
    const { error } = await supabase.from("otp_sms").upsert(
      {
        otp_id: uuidv4(),
        phone_country_code: phoneCountryCode,
        phone_number: phoneNumber,
        otp_hash: otpHash,
        expires_at: expiresAt,
        verified: false,
        attempts: 0,
      },
      { onConflict: ["phone_number"] }
    );

    if (error) throw error;
  }

  /**
   * Get OTP data
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
    await supabase.from("otp_sms").update({ verified: true }).eq("otp_id", otpId);
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
   * Create client
   */
  async createClient(phoneCountryCode, phoneNumber, hashedPassword, profId) {
    const clientRoleId = await this.getClientRoleId();

    const { data, error } = await supabase
      .from("client")
      .insert({
        client_country_code: phoneCountryCode,
        client_number: phoneNumber,
        client_password: hashedPassword,
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
    await supabase.from("otp_sms").delete().eq("otp_id", otpId);
  }

  /**
   * Get client by phone number
   */
  async getClientByPhone(phoneCountryCode, phoneNumber) {
    const { data, error } = await supabase
      .from("client")
      .select(`
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
      `)
      .eq("client_country_code", phoneCountryCode)
      .eq("client_number", phoneNumber)
      .single();

    if (error || !data) {
      throw new Error("Invalid phone number or password");
    }

    return data;
  }

  /**
   * Generate JWT token
   */
  generateToken(clientId, clientNumber) {
    return jwt.sign({ client_id: clientId, client_number: clientNumber }, JWT_SECRET, {
      expiresIn: "7d",
    });
  }

  /**
   * Get or create chat group
   */
  async getOrCreateChatGroup(clientId) {
    // Check if chat group exists
    const { data: existingGroup, error: groupError } = await supabase
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
    console.log(deptId)
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
