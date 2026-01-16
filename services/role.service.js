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
}

module.exports = new RoleService();
