const supabase = require("../helpers/supabaseClient");

class ChangeRoleService {
  /**
   * Get all users with their roles and profile pictures
   */
  async getAllUsersWithRoles() {
    const { data: users, error: userError } = await supabase
      .from("sys_user")
      .select(`
        sys_user_id,
        sys_user_email,
        sys_user_is_active,
        role_id,
        prof_id
      `)
      .order("sys_user_email", { ascending: true });

    if (userError) throw userError;

    // Get all roles
    const { data: roles, error: roleError } = await supabase
      .from("role")
      .select("role_id, role_name")
      .eq("role_is_active", true);

    if (roleError) throw roleError;

    // Get profile pictures for users with prof_id
    const profileIds = users.filter(u => u.prof_id).map(u => u.prof_id);
    let profileImages = {};
    
    if (profileIds.length > 0) {
      const { data: images, error: imageError } = await supabase
        .from("image")
        .select("prof_id, img_location, img_is_current")
        .in("prof_id", profileIds)
        .eq("img_is_current", true);

      if (!imageError && images) {
        // Create a map of prof_id to image location
        images.forEach(img => {
          profileImages[img.prof_id] = img.img_location;
        });
      }
    }

    // Combine the data
    const response = users.map((user) => ({
      sys_user_id: user.sys_user_id,
      sys_user_email: user.sys_user_email,
      sys_user_is_active: user.sys_user_is_active,
      role_id: user.role_id,
      profile_picture: user.prof_id ? profileImages[user.prof_id] : null,
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
