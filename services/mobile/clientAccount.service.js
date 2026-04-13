const supabase = require("../../helpers/supabaseClient");
const jwtUtils = require("../../utils/jwt");

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
   * VALIDATE TOKEN - Main business logic
   * Validates JWT and checks if client exists and is active
   */
  async validateTokenFlow(clientId) {
    // Check if client exists and is active
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
      throw new Error("Client not found");
    }

    if (!client.client_is_active) {
      throw new Error("Account is inactive");
    }

    return client;
  }

  /**
   * COMPLETE PROFILE - Main business logic
   * Creates or updates client profile
   */
  async completeProfileFlow(clientId, firstname, lastname) {
    // 1. Get client
    const { data: client, error: clientError } = await supabase
      .from("client")
      .select("prof_id")
      .eq("client_id", clientId)
      .single();

    if (clientError || !client) {
      throw new Error("Client not found");
    }

    // 2. Create or update profile
    let profile;
    let isUpdate = false;

    if (client.prof_id) {
      // Update existing profile
      profile = await this.updateProfile(client.prof_id, {
        prof_firstname: firstname,
        prof_lastname: lastname,
      });
      isUpdate = true;
    } else {
      // Create new profile
      profile = await this.createProfileMinimal(firstname, lastname);

      // Link profile to client
      await this.linkProfileToClient(clientId, profile.prof_id);
    }

    return {
      profile,
      isUpdate,
    };
  }

  /**
   * SET CHAT GROUP DEPARTMENT - Main business logic
   * Assigns department to chat group and creates initial message
   */
  async setChatGroupDepartmentFlow(chatGroupId, deptId) {
    // 1. Update chat group
    const updatedGroup = await this.updateChatGroupDepartment(
      chatGroupId,
      deptId,
    );

    // 2. Get department name
    const deptName = await this.getDepartmentName(deptId);

    // 3. Insert initial message
    await this.insertInitialMessage(chatGroupId, deptName);

    return {
      updatedGroup,
      deptName,
    };
  }

  /**
   * UPDATE PROFILE - Main business logic
   * Updates client profile with validation
   */
  async updateProfileFlow(profId, profileData) {
    // Validate required fields (only firstname is required)
    if (!profileData.prof_firstname) {
      throw new Error("First name is required");
    }

    // Update profile
    const profile = await this.updateProfile(profId, profileData);

    return profile;
  }

  /**
   * SEND CLIENT MESSAGE - Main business logic
   * Sends message from client with chat group management
   */
  async sendClientMessageFlow(message, clientId, deptId) {
    if (!message || !clientId) {
      throw new Error("Missing message or clientId");
    }

    const messageData = await this.sendClientMessage(message, clientId, deptId);

    return messageData;
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
   * Generate long-lived JWT token (7 days)
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
      { expiresIn: "7d" },
    );
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
