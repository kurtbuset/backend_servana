const supabase = require("../helpers/supabaseClient");
const profileService = require("./profile.service");

// Role name constants - more maintainable than hardcoded IDs
const ROLE_NAMES = {
  AGENT: "Agent",
  ADMIN: "Admin",
  CLIENT: "Client",
};

class AgentService {
  /**
   * Get all agents with their departments
   */
  async getAllAgents() {
    try {
      // First, get the agent role ID by role name
      const { data: agentRole, error: roleError } = await supabase
        .from("role")
        .select("role_id")
        .eq("role_name", ROLE_NAMES.AGENT) // Use constant instead of hardcoded string
        .single();

      if (roleError || !agentRole) {
        console.error("Error fetching agent role:", roleError);
        throw new Error("Agent role not found");
      }

      // Get all users with agent role
      const { data: users, error: userError } = await supabase
        .from("sys_user")
        .select(`
          sys_user_id,
          sys_user_email,
          sys_user_is_active,
          role_id
        `)
        .eq("role_id", agentRole.role_id)
        .order("sys_user_email", { ascending: true });

      if (userError) {
        console.error("Error fetching users:", userError);
        throw userError;
      }

      if (!users || users.length === 0) {
        return [];
      }

      // Get user-department relationships
      const userIds = users.map(u => u.sys_user_id);
      const { data: userDepts, error: deptError } = await supabase
        .from("sys_user_department")
        .select(`
          sys_user_id,
          department:dept_id (
            dept_name
          )
        `)
        .in("sys_user_id", userIds);

      if (deptError) {
        console.error("Error fetching departments:", deptError);
        // Don't throw error, just continue without departments
      }

      // Format the response
      const formattedAgents = users.map((user) => {
        const userDepartments = userDepts 
          ? userDepts
              .filter(ud => ud.sys_user_id === user.sys_user_id)
              .map(ud => ud.department?.dept_name)
              .filter(name => name) // Remove null/undefined names
          : [];

        return {
          id: user.sys_user_id,
          email: user.sys_user_email,
          active: user.sys_user_is_active,
          departments: userDepartments,
        };
      });

      return formattedAgents;
    } catch (error) {
      console.error("Error in getAllAgents:", error);
      throw error;
    }
  }

  /**
   * Get all active departments
   */
  async getActiveDepartments() {
    try {
      const { data, error } = await supabase
        .from("department")
        .select("dept_name")
        .eq("dept_is_active", true)
        .order("dept_name", { ascending: true });

      if (error) {
        console.error("Error fetching departments:", error);
        throw error;
      }

      return data ? data.map((d) => d.dept_name) : [];
    } catch (error) {
      console.error("Error in getActiveDepartments:", error);
      throw error;
    }
  }

  /**
   * Get system user by ID
   */
  async getSystemUserById(userId) {
    const { data, error } = await supabase
      .from("sys_user")
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
      .from("sys_user")
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
    let authUserId = null;
    let newUserId = null;
    let profileId = null;

    try {
      console.log(`🔄 Creating agent: ${email}`);

      // Step 1: Create Supabase Auth user
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (authError) {
        console.error('❌ Auth user creation failed:', authError);
        throw authError;
      }
      
      authUserId = authUser.user.id;
      console.log(`✅ Auth user created: ${authUserId}`);

      // Step 2: Create profile
      const profile = await profileService.createMinimalProfile();
      profileId = profile.prof_id;
      console.log(`✅ Profile created: ${profileId}`);

      // Step 3: Insert system_user with profile link
      const { data: insertedUser, error: insertError } = await supabase
        .from("sys_user")
        .insert({
          sys_user_email: email,
          sys_user_is_active: true,
          supabase_user_id: authUserId,
          prof_id: profileId, // Link to the created profile
          sys_user_created_at: new Date(),
          role_id: roleId,
        })
        .select("sys_user_id")
        .single();

      if (insertError) {
        console.error('❌ System user creation failed:', insertError);
        throw insertError;
      }

      newUserId = insertedUser.sys_user_id;
      console.log(`✅ System user created: ${newUserId}`);

      // Step 4: Handle departments
      if (departments && departments.length > 0) {
        const deptRows = await this.getDepartmentIdsByNames(departments);
        await this.insertUserDepartments(newUserId, deptRows.map((d) => d.dept_id));
        console.log(`✅ Departments assigned: ${departments.join(', ')}`);
      }

      console.log(`✅ Agent creation completed successfully: ${email}`);
      return { id: newUserId, email };

    } catch (error) {
      console.error(`❌ Agent creation failed for ${email}:`, error.message);

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
        if (authUserId) {
          console.log(`🔄 Rolling back auth user: ${authUserId}`);
          await supabase.auth.admin.deleteUser(authUserId);
        }

        console.log('✅ Rollback completed successfully');
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError.message);
        // Don't throw rollback error, throw original error
      }

      throw error;
    }
  }
}

module.exports = new AgentService();
