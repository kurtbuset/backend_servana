const supabase = require("../helpers/supabaseClient");

class ChangeRoleService {
  /**
   * Get all users with their roles
   */
  async getAllUsersWithRoles() {
    const { data: users, error: userError } = await supabase
      .from("sys_user")
      .select(`
        sys_user_id,
        sys_user_email,
        sys_user_is_active,
        role_id
      `)
      .order("sys_user_email", { ascending: true });

    if (userError) throw userError;

    // Get all roles
    const { data: roles, error: roleError } = await supabase
      .from("role")
      .select("role_id, role_name")
      .eq("role_is_active", true);

    if (roleError) throw roleError;

    // Combine the data
    const response = users.map((user) => ({
      sys_user_id: user.sys_user_id,
      sys_user_email: user.sys_user_email,
      sys_user_is_active: user.sys_user_is_active,
      role_id: user.role_id,
      all_roles: roles,
    }));

    return response;
  }

  /**
   * Get all roles (active + inactive)
   */
  async getAllRoles() {
    const { data, error } = await supabase
      .from("role")
      .select("role_id, role_name, role_is_active")
      .order("role_name", { ascending: true });

    if (error) throw error;
    return data;
  }

  /**
   * Update user's role or active status
   */
  async updateUserRole(userId, roleId, isActive, updatedBy) {
    const updateData = {
      sys_user_updated_at: new Date(),
      sys_user_updated_by: updatedBy || null,
    };

    if (roleId !== undefined) updateData.role_id = roleId;
    if (typeof isActive === "boolean") updateData.sys_user_is_active = isActive;

    const { data, error } = await supabase
      .from("sys_user")
      .update(updateData)
      .eq("sys_user_id", userId)
      .select("sys_user_id, sys_user_email, role_id, sys_user_is_active")
      .single();

    if (error) throw error;
    return data;
  }
}

module.exports = new ChangeRoleService();
