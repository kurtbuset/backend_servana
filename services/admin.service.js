const supabase = require("../helpers/supabaseClient");

const ADMIN_ROLE_ID = 1;

class AdminService {
  /**
   * Get all admins
   */
  async getAllAdmins() {
    const { data, error } = await supabase
      .from("sys_user")
      .select("sys_user_id, sys_user_email, sys_user_is_active, supabase_user_id")
      .eq("role_id", ADMIN_ROLE_ID)
      .order("sys_user_email", { ascending: true });

    if (error) throw error;
    return data;
  }

  /**
   * Create a new admin
   */
  async createAdmin(email, password, createdBy) {
    // Create user in Supabase Auth
    const { data: createdUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authErr) {
      throw new Error(authErr.message);
    }

    const supabaseUserId = createdUser.user.id;

    // Insert into system_user table
    const { data, error } = await supabase
      .from("system_user")
      .insert([
        {
          sys_user_email: email,
          sys_user_is_active: true,
          role_id: ADMIN_ROLE_ID,
          sys_user_created_by: createdBy,
          sys_user_updated_by: createdBy,
          supabase_user_id: supabaseUserId,
        },
      ])
      .select("sys_user_id, sys_user_email, sys_user_is_active, supabase_user_id")
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update an admin
   */
  async updateAdmin(adminId, email, password, isActive, updatedBy) {
    // Fetch supabase_user_id
    const { data: existingUser, error: fetchErr } = await supabase
      .from("system_user")
      .select("supabase_user_id")
      .eq("sys_user_id", adminId)
      .single();

    if (fetchErr || !existingUser) {
      throw new Error("User not found");
    }

    const supabaseUserId = existingUser.supabase_user_id;

    // Update in Supabase Auth if needed
    if (email || password) {
      const updates = {};
      if (email) updates.email = email;
      if (password && password.trim() !== "") {
        updates.password = password;
      }

      if (Object.keys(updates).length > 0) {
        const { error: authUpdateErr } = await supabase.auth.admin.updateUserById(
          supabaseUserId,
          updates
        );
        if (authUpdateErr) throw new Error(authUpdateErr.message);
      }
    }

    // Update in system_user table
    const updateData = {
      sys_user_updated_by: updatedBy,
      sys_user_updated_at: new Date(),
      role_id: ADMIN_ROLE_ID,
    };

    if (email !== undefined) updateData.sys_user_email = email;
    if (isActive !== undefined) updateData.sys_user_is_active = isActive;

    const { data, error } = await supabase
      .from("system_user")
      .update(updateData)
      .eq("sys_user_id", adminId)
      .select("sys_user_id, sys_user_email, sys_user_is_active, supabase_user_id")
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Toggle admin active status
   */
  async toggleAdminStatus(adminId, isActive, updatedBy) {
    // Fetch supabase_user_id
    const { data: existingUser, error: fetchErr } = await supabase
      .from("system_user")
      .select("supabase_user_id")
      .eq("sys_user_id", adminId)
      .single();

    if (fetchErr || !existingUser) {
      throw new Error("User not found");
    }

    const supabaseUserId = existingUser.supabase_user_id;

    // Disable or enable Supabase Auth account
    const { error: disableErr } = await supabase.auth.admin.updateUserById(supabaseUserId, {
      ban: !isActive,
    });

    if (disableErr) throw new Error(disableErr.message);

    // Update in system_user
    const { data, error } = await supabase
      .from("system_user")
      .update({
        sys_user_is_active: isActive,
        sys_user_updated_at: new Date(),
        sys_user_updated_by: updatedBy,
        role_id: ADMIN_ROLE_ID,
      })
      .eq("sys_user_id", adminId)
      .select("sys_user_id, sys_user_email, sys_user_is_active, supabase_user_id")
      .single();

    if (error) throw error;
    return data;
  }
}

module.exports = new AdminService();
