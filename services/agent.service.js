const supabase = require("../helpers/supabaseClient");

class AgentService {
  /**
   * Get all agents with their departments
   */
  async getAllAgents() {
    const { data, error } = await supabase
      .from("sys_user")
      .select(`
        sys_user_id,
        sys_user_email,
        sys_user_is_active,
        sys_user_department (
          department (
            dept_name
          )
        )
      `)
      .order("sys_user_email", { ascending: true });

    if (error) throw error;

    const formattedAgents = data.map((agent) => ({
      id: agent.sys_user_id,
      email: agent.sys_user_email,
      active: agent.sys_user_is_active,
      departments: agent.sys_user_department.map((d) => d.department.dept_name),
    }));

    return formattedAgents;
  }

  /**
   * Get all active departments
   */
  async getActiveDepartments() {
    const { data, error } = await supabase
      .from("department")
      .select("dept_name")
      .eq("dept_is_active", true);

    if (error) throw error;
    return data.map((d) => d.dept_name);
  }

  /**
   * Get system user by ID
   */
  async getSystemUserById(userId) {
    const { data, error } = await supabase
      .from("system_user")
      .select("supabase_user_id")
      .eq("sys_user_id", userId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update system user
   */
  async updateSystemUser(userId, email, isActive) {
    const { error } = await supabase
      .from("system_user")
      .update({
        sys_user_email: email,
        sys_user_is_active: isActive,
        sys_user_updated_at: new Date(),
      })
      .eq("sys_user_id", userId);

    if (error) throw error;
  }

  /**
   * Delete user departments
   */
  async deleteUserDepartments(userId) {
    await supabase.from("sys_user_department").delete().eq("sys_user_id", userId);
  }

  /**
   * Get department IDs by names
   */
  async getDepartmentIdsByNames(departmentNames) {
    const { data, error } = await supabase
      .from("department")
      .select("dept_id, dept_name")
      .in("dept_name", departmentNames);

    if (error) throw error;
    return data;
  }

  /**
   * Insert user departments
   */
  async insertUserDepartments(userId, departmentIds) {
    const insertRows = departmentIds.map((deptId) => ({
      sys_user_id: userId,
      dept_id: deptId,
    }));

    const { error } = await supabase.from("sys_user_department").insert(insertRows);

    if (error) throw error;
  }

  /**
   * Update Supabase Auth user
   */
  async updateAuthUser(authUserId, email, password) {
    const attrs = {};
    if (password?.length > 0) attrs.password = password;
    if (email) attrs.email = email;

    if (Object.keys(attrs).length > 0) {
      const { error } = await supabase.auth.admin.updateUserById(authUserId, attrs);
      if (error) throw error;
    }
  }

  /**
   * Create new agent
   */
  async createAgent(email, password, departments, roleId = 3) {
    // Create Supabase Auth user
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) throw authError;
    const authUserId = authUser.user.id;

    // Insert system_user
    const { data: insertedUser, error: insertError } = await supabase
      .from("system_user")
      .insert({
        sys_user_email: email,
        sys_user_is_active: true,
        supabase_user_id: authUserId,
        sys_user_created_at: new Date(),
        role_id: roleId,
      })
      .select("sys_user_id")
      .single();

    if (insertError) throw insertError;
    const newUserId = insertedUser.sys_user_id;

    // Handle departments
    if (departments && departments.length > 0) {
      const deptRows = await this.getDepartmentIdsByNames(departments);
      await this.insertUserDepartments(newUserId, deptRows.map((d) => d.dept_id));
    }

    return { id: newUserId, email };
  }
}

module.exports = new AgentService();
