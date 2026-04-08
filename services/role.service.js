const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");

// Permission label-to-column mapping
const permissionMap = {
  "Can view Chats": "priv_can_view_message",
  "Can Reply": "priv_can_message",
  "Can Manage Profile": "priv_can_manage_profile",
  "Can send Macros": "priv_can_use_canned_mess",
  "Can End Chat": "priv_can_end_chat",
  "Can Transfer Department": "priv_can_transfer",
  "Can View Departments": "priv_can_view_dept",
  "Can Add Departments": "priv_can_add_dept",
  "Can Edit Departments": "priv_can_edit_dept",
  "Can Edit Department": "priv_can_manage_dept", // Legacy - kept for backward compatibility
  "Can Assign Department": "priv_can_assign_dept",
  "Can Edit Roles": "priv_can_manage_role",
  "Can View Change Roles": "priv_can_view_change_roles",
  "Can Edit Change Roles": "priv_can_edit_change_roles",
  "Can Assign Roles": "priv_can_assign_role", // Legacy - kept for backward compatibility
  "Can Add Admin Accounts": "priv_can_create_account",
  "Can View Auto-Replies": "priv_can_view_auto_reply",
  "Can Add Auto-Replies": "priv_can_add_auto_reply",
  "Can Edit Auto-Replies": "priv_can_edit_auto_reply",
  "Can Delete Auto-Replies": "priv_can_delete_auto_reply",
  "Can Manage Auto-Replies": "priv_can_manage_auto_reply", // Legacy - kept for backward compatibility
  "Can View Macros": "priv_can_view_macros",
  "Can Add Macros": "priv_can_add_macros",
  "Can Edit Macros": "priv_can_edit_macros",
  "Can Delete Macros": "priv_can_delete_macros",
  "Can send Macros": "priv_can_use_canned_mess", // Legacy - kept for backward compatibility
  "Can View Manage Agents": "priv_can_view_manage_agents",
  "Can View Agents Information": "priv_can_view_agents_info",
  "Can Create Agent Account": "priv_can_create_agent_account",
  "Can Edit Manage Agents": "priv_can_edit_manage_agents",
  "Can Edit Department Manage Agents": "priv_can_edit_dept_manage_agents",
  "Can View Analytics Manage Agents": "priv_can_view_analytics_manage_agents",
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
   * Get all roles with permissions — cache-aside with 24-hour TTL
   */
  async getAllRoles() {
    const cached = await cacheService.getRoles();
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const { data, error } = await supabase
      .from("role")
      .select(
        `
        role_id,
        role_name,
        role_is_active,
        priv_id,
        privilege:priv_id (
          ${Object.values(permissionMap).join(", ")}
        )
      `,
      )
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
          Object.keys(permissionMap).find((k) => permissionMap[k] === key),
        )
        .filter(Boolean),
    }));

    await cacheService.updateRoles(formatted);
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
    await cacheService.invalidateRoles();
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
    await cacheService.invalidateRoles();
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
}

module.exports = new RoleService();
