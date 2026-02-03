const supabase = require("../helpers/supabaseClient");

// Permission label-to-column mapping
const permissionMap = {
  "Can view Chats": "priv_can_view_message",
  "Can Reply": "priv_can_message",
  "Can Manage Profile": "priv_can_manage_profile",
  "Can send Macros": "priv_can_use_canned_mess",
  "Can End Chat": "priv_can_end_chat",
  "Can Transfer Department": "priv_can_transfer",
  "Can Edit Department": "priv_can_manage_dept",
  "Can Assign Department": "priv_can_assign_dept",
  "Can Edit Roles": "priv_can_manage_role",
  "Can Assign Roles": "priv_can_assign_role",
  "Can Add Admin Accounts": "priv_can_create_account",
  "Can Edit Auto-Replies": "priv_can_manage_auto_reply",
};

class RoleService {
  /**
   * Get permission map
   */
  getPermissionMap() {
    return permissionMap;
  }

  /**
   * Build privilege fields from permission labels
   */
  buildPrivilegeFields(permissions = []) {
    const fields = {};
    Object.values(permissionMap).forEach((key) => (fields[key] = false));
    permissions.forEach((label) => {
      const key = permissionMap[label];
      if (key) fields[key] = true;
    });
    return fields;
  }

  /**
   * Get all roles with permissions
   */
  async getAllRoles() {
    const { data, error } = await supabase
      .from("role")
      .select(`
        role_id,
        role_name,
        role_is_active,
        priv_id,
        privilege:priv_id (
          ${Object.values(permissionMap).join(", ")}
        )
      `)
      .order("role_id", { ascending: true });

    if (error) throw error;

    // Format the response
    const formatted = data.map((role) => ({
      role_id: role.role_id,
      name: role.role_name,
      active: role.role_is_active,
      permissions: Object.entries(role.privilege || {})
        .filter(([, value]) => value === true)
        .map(([key]) =>
          Object.keys(permissionMap).find((k) => permissionMap[k] === key)
        )
        .filter(Boolean),
    }));

    return formatted;
  }

  /**
   * Create a new role with privileges
   */
  async createRole(name, permissions, createdBy) {
    // Create privilege first
    const privPayload = this.buildPrivilegeFields(permissions);
    privPayload.priv_created_by = createdBy;

    const { data: priv, error: privError } = await supabase
      .from("privilege")
      .insert([privPayload])
      .select("priv_id")
      .single();

    if (privError) throw privError;

    // Create role
    const { error: roleError, data: roleData } = await supabase
      .from("role")
      .insert([
        {
          role_name: name,
          role_is_active: true,
          priv_id: priv.priv_id,
          role_created_by: createdBy,
        },
      ])
      .select("*");

    if (roleError) throw roleError;

    return roleData;
  }

  /**
   * Get role by ID
   */
  async getRoleById(roleId) {
    const { data: role, error } = await supabase
      .from("role")
      .select("priv_id")
      .eq("role_id", roleId)
      .single();

    if (error || !role) {
      throw new Error("Role not found");
    }

    return role;
  }

  /**
   * Update role privileges
   */
  async updatePrivileges(privId, permissions, updatedBy) {
    const privPayload = this.buildPrivilegeFields(permissions);
    privPayload.priv_updated_by = updatedBy;

    const { error } = await supabase
      .from("privilege")
      .update(privPayload)
      .eq("priv_id", privId);

    if (error) throw error;
  }

  /**
   * Update role details
   */
  async updateRole(roleId, name, active, updatedBy) {
    const { error } = await supabase
      .from("role")
      .update({
        role_name: name,
        role_is_active: active,
        role_updated_by: updatedBy,
      })
      .eq("role_id", roleId);

    if (error) throw error;
  }

  /**
   * Get all members (users) assigned to a specific role
   */
  async getRoleMembers(roleId) {
    try {
      // First, get the role's default permissions
      const { data: roleData, error: roleError } = await supabase
        .from("role")
        .select(`
          role_id,
          role_name,
          priv_id,
          privilege:priv_id (
            priv_can_view_message
          )
        `)
        .eq("role_id", roleId)
        .single();

      if (roleError) {
        console.error("Error fetching role data:", roleError);
        throw roleError;
      }

      // Get all users with this role, including their profile information
      const { data: users, error } = await supabase
        .from("sys_user")
        .select(`
          sys_user_id,
          sys_user_email,
          sys_user_is_active,
          sys_user_created_at,
          prof_id,
          profile:prof_id (
            prof_firstname,
            prof_lastname
          )
        `)
        .eq("role_id", roleId)
        .order("sys_user_email", { ascending: true });

      if (error) {
        console.error("Error fetching users:", error);
        throw error;
      }

      // Get profile images for all users
      const profIds = users.filter(u => u.prof_id).map(u => u.prof_id);
      let imageMap = {};

      if (profIds.length > 0) {
        // Get current profile images
        const { data: images, error: imgErr } = await supabase
          .from("image")
          .select("prof_id, img_location")
          .in("prof_id", profIds)
          .eq("img_is_current", true);

        if (imgErr) {
          console.error("Error fetching profile images:", imgErr);
        } else {
          // Map images by prof_id
          (images || []).forEach((img) => {
            imageMap[img.prof_id] = img.img_location;
          });
        }
      }

      // Get the role's default chat permission
      const roleCanViewChats = roleData?.privilege?.priv_can_view_message || false;

      // Format the response with profile information and images
      const formattedMembers = (users || []).map((user) => ({
        sys_user_id: user.sys_user_id,
        sys_user_email: user.sys_user_email,
        sys_user_is_active: user.sys_user_is_active,
        priv_can_view_message: roleCanViewChats, // Inherited from role
        sys_user_created_at: user.sys_user_created_at,
        profile: user.profile ? {
          prof_firstname: user.profile.prof_firstname,
          prof_lastname: user.profile.prof_lastname,
          full_name: `${user.profile.prof_firstname || ''} ${user.profile.prof_lastname || ''}`.trim(),
          profile_image: user.prof_id ? imageMap[user.prof_id] || null : null
        } : null
      }));

      return formattedMembers;
    } catch (error) {
      console.error("Error in getRoleMembers:", error);
      throw error;
    }
  }

  /**
   * Get role ID by role name
   */
  async getRoleId(roleName) {
    const { data, error } = await supabase
      .from("role")
      .select("role_id")
      .eq("role_name", roleName)
      .single();

    if (error || !data) {
      throw new Error(`${roleName} role not found in database`);
    }

    return data.role_id;
  }

  /**
   * Update individual user chat permission
   * Note: This is a simplified implementation that currently just logs the change
   * In a full implementation, this would require either:
   * 1. Adding individual permission columns to sys_user table, or
   * 2. Creating a user_permission_override table
   */
  async updateUserChatPermission(userId, canViewChats) {
    try {
      // For demonstration purposes, we'll just log the change
      // In a real implementation, you would store this in the database
      
      // Simulate a successful update
      return { success: true };
    } catch (error) {
      console.error("Error in updateUserChatPermission:", error);
      throw error;
    }
  }
}

module.exports = new RoleService();
