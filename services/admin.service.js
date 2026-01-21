const supabase = require("../helpers/supabaseClient");
const profileService = require("./profile.service");

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
    let supabaseUserId = null;
    let profileId = null;
    let newUserId = null;

    try {
      console.log(`🔄 Creating admin: ${email}`);

      // Step 1: Create user in Supabase Auth
      const { data: createdUser, error: authErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (authErr) {
        console.error('❌ Auth user creation failed:', authErr);
        throw new Error(authErr.message);
      }

      supabaseUserId = createdUser.user.id;
      console.log(`✅ Auth user created: ${supabaseUserId}`);

      // Step 2: Create profile
      const profile = await profileService.createMinimalProfile();
      profileId = profile.prof_id;
      console.log(`✅ Profile created: ${profileId}`);

      // Step 3: Insert into sys_user table with profile link
      const { data, error } = await supabase
        .from("sys_user")
        .insert([
          {
            sys_user_email: email,
            sys_user_is_active: true,
            role_id: ADMIN_ROLE_ID,
            prof_id: profileId, // Link to the created profile
            sys_user_created_by: createdBy,
            sys_user_updated_by: createdBy,
            supabase_user_id: supabaseUserId,
          },
        ])
        .select("sys_user_id, sys_user_email, sys_user_is_active, supabase_user_id")
        .single();

      if (error) {
        console.error('❌ System user creation failed:', error);
        throw error;
      }

      newUserId = data.sys_user_id;
      console.log(`✅ System user created: ${newUserId}`);
      console.log(`✅ Admin creation completed successfully: ${email}`);

      return data;

    } catch (error) {
      console.error(`❌ Admin creation failed for ${email}:`, error.message);

      // Rollback operations in reverse order
      try {
        // Remove system user if created
        if (newUserId) {
          console.log(`🔄 Rolling back system user: ${newUserId}`);
          await supabase.from("sys_user").delete().eq("sys_user_id", newUserId);
        }

        // Remove profile if created
        if (profileId) {
          console.log(`🔄 Rolling back profile: ${profileId}`);
          await supabase.from("profile").delete().eq("prof_id", profileId);
        }

        // Remove auth user if created
        if (supabaseUserId) {
          console.log(`🔄 Rolling back auth user: ${supabaseUserId}`);
          await supabase.auth.admin.deleteUser(supabaseUserId);
        }

        console.log('✅ Rollback completed successfully');
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError.message);
        // Don't throw rollback error, throw original error
      }

      throw error;
    }
  }

  /**
   * Update an admin
   */
  async updateAdmin(adminId, email, password, isActive, updatedBy) {
    // Fetch supabase_user_id
    const { data: existingUser, error: fetchErr } = await supabase
      .from("sys_user")
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

    // Update in sys_user table
    const updateData = {
      sys_user_updated_by: updatedBy,
      sys_user_updated_at: new Date(),
      role_id: ADMIN_ROLE_ID,
    };

    if (email !== undefined) updateData.sys_user_email = email;
    if (isActive !== undefined) updateData.sys_user_is_active = isActive;

    const { data, error } = await supabase
      .from("sys_user")
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
      .from("sys_user")
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

    // Update in sys_user
    const { data, error } = await supabase
      .from("sys_user")
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
