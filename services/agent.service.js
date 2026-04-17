const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");
const profileService = require("./profile.service");
const roleService = require("./role.service");

// Role name constants - more maintainable than hardcoded IDs
const ROLE_NAMES = {
  AGENT: "Agent",
  ADMIN: "Admin",
  CLIENT: "Client",
};

class AgentService {
  /**
   * Get all agents with their departments and profile pictures - Redis caching with 2-hour TTL
   * Cache-first approach: if cache found, return cache data; if not, use business logic for data fetching
   */
  async getAllAgents() {
    try {
      // Try to get from cache first
      const cachedAgents = await cacheService.getAgents();
      
      if (cachedAgents !== null && cachedAgents !== undefined) {
        console.log('cache hit, fetching agents from redis')
        return cachedAgents;
      }
      
      // Cache miss - use business logic for data fetching
      console.log('⚠️ Cache MISS: Fetching agents from database');
      
      // First, get the agent role ID by role name
      console.log("🔍 Fetching agent role with name:", ROLE_NAMES.AGENT);
      const { data: agentRole, error: roleError } = await supabase
        .from("role")
        .select("role_id")
        .eq("role_name", ROLE_NAMES.AGENT) // Use constant instead of hardcoded string
        .single();

      console.log("🔍 Agent role query result:", { agentRole, roleError });

      if (roleError || !agentRole) {
        console.error("Error fetching agent role:", roleError);
        throw new Error("Agent role not found");
      }

      // Get all users with agent role including profile
      console.log("🔍 Fetching users with agent role_id:", agentRole.role_id);
      const { data: users, error: userError } = await supabase
        .from("sys_user")
        .select(`
          sys_user_id,
          sys_user_email,
          sys_user_is_active,
          role_id,
          prof_id
        `)
        .eq("role_id", agentRole.role_id)
        .order("sys_user_email", { ascending: true });

      console.log("🔍 Users query result:", { usersCount: users?.length || 0, userError });

      if (userError) {
        console.error("Error fetching users:", userError);
        throw userError;
      }

      if (!users || users.length === 0) {
        // Cache empty result to avoid repeated database queries
        await cacheService.updateAgents([]);
        // console.log('✅ Cached empty agents result with 2-hour TTL');
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

      // Get profile pictures for users with prof_id
      const profileIds = users.filter(u => u.prof_id).map(u => u.prof_id);
      let profileImages = {};
      
      if (profileIds.length > 0) {
        const { data: images, error: imageError } = await supabase
          .from("image")
          .select("prof_id, img_location, img_is_current, img_created_at")
          .in("prof_id", profileIds)
          .eq("img_is_current", true);

        if (!imageError && images) {
          // Create a map of prof_id to image location
          images.forEach(img => {
            profileImages[img.prof_id] = img.img_location;
          });
        }
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
          profile_picture: user.prof_id ? profileImages[user.prof_id] : null,
        };
      });

      // Cache the result for future requests with 2-hour TTL
      await cacheService.updateAgents(formattedAgents);

      return formattedAgents;
    } catch (error) {
      console.error("❌ Error in getAllAgents:", error.message);
      
      // Fallback: try to return stale cache data if available
      try {
        const staleCachedData = await cacheService.getAgents();
        if (staleCachedData !== null && staleCachedData !== undefined) {
          console.log('⚠️ Returning stale cache data due to database error');
          return staleCachedData;
        }
      } catch (cacheError) {
        console.error('❌ Cache fallback also failed:', cacheError.message);
      }
      
      throw error;
    }
  }

  /**
   * Get all active departments - Redis caching with 4-hour TTL
   * Cache-first approach: if cache found, return cache data; if not, use business logic for data fetching
   */
  async getActiveDepartments() {
    try {
      // Try to get from department cache first
      const cachedDepartments = await cacheService.getDepartments();
      
      if (cachedDepartments !== null && cachedDepartments !== undefined) {
        // Filter active departments and extract names
        const activeDepartmentNames = cachedDepartments
          .filter(dept => dept.dept_is_active === true)
          .map(dept => dept.dept_name)
          .sort();
        
        // console.log(`✅ Cache HIT: Retrieved ${activeDepartmentNames.length} active departments from cache`);
        return activeDepartmentNames;
      }
      
      // Cache miss - use business logic for data fetching
      console.log('⚠️ Cache MISS: Fetching active departments from database');
      const { data, error } = await supabase
        .from("department")
        .select("dept_name")
        .eq("dept_is_active", true)
        .order("dept_name", { ascending: true });

      if (error) {
        console.error("Error fetching departments:", error);
        throw error;
      }

      const departmentNames = data ? data.map((d) => d.dept_name) : [];
      
      // Note: We don't cache here since this is a filtered view of departments
      // The full department cache is managed by the department service
      
      return departmentNames;
    } catch (error) {
      console.error("❌ Error in getActiveDepartments:", error.message);
      
      // Fallback: try to return stale cache data if available
      try {
        const staleCachedData = await cacheService.getDepartments();
        if (staleCachedData !== null && staleCachedData !== undefined) {
          const activeDepartmentNames = staleCachedData
            .filter(dept => dept.dept_is_active === true)
            .map(dept => dept.dept_name)
            .sort();
          console.log('⚠️ Returning stale cache data due to database error');
          return activeDepartmentNames;
        }
      } catch (cacheError) {
        console.error('❌ Cache fallback also failed:', cacheError.message);
      }
      
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
    
    // Invalidate agents cache after update
    await cacheService.invalidateAgents();
    console.log("🧹 Invalidated agents cache after system user update");
  }

  /**
   * Delete user departments
   */
  async deleteUserDepartments(userId) {
    await supabase.from("sys_user_department").delete().eq("sys_user_id", userId);

    // Invalidate agents cache and the per-user department list used by queue service
    await cacheService.invalidateAgents();
    await cacheService.invalidateUserDepartments(userId);
    console.log("🧹 Invalidated agents cache after user departments deletion");
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

    // Invalidate agents cache and the per-user department list used by queue service
    await cacheService.invalidateAgents();
    await cacheService.invalidateUserDepartments(userId);
    console.log("🧹 Invalidated agents cache after user departments insertion");
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
   * Create new agent using atomic RPC (with manual fallback)
   */
  async createAgent(email, password, departments, roleId = null) {
    let authUserId = null;

    try {
      // Step 1: Get Agent role ID if not provided
      if (!roleId) {
        roleId = await roleService.getRoleId(ROLE_NAMES.AGENT);
      }

      // Step 2: Create Supabase Auth user (external, cannot be in DB transaction)
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

      // Step 3: Resolve department IDs
      let deptIds = [];
      if (departments && departments.length > 0) {
        const deptRows = await this.getDepartmentIdsByNames(departments);
        deptIds = deptRows.map((d) => d.dept_id);
      }

      // Step 4: Create profile + sys_user + departments atomically via RPC
      const { data: rpcResult, error: rpcError } = await supabase.rpc('create_agent_atomic', {
        p_email: email,
        p_role_id: roleId,
        p_supabase_user_id: authUserId,
        p_dept_ids: deptIds,
      });

      if (rpcError) {
        console.error('❌ Atomic agent creation failed:', rpcError.message);
        throw rpcError;
      }

      // Invalidate agents cache after successful creation
      await cacheService.invalidateAgents();
      console.log("🧹 Invalidated agents cache after agent creation");

      return { id: rpcResult.sys_user_id, email };

    } catch (error) {
      console.error(`❌ Agent creation failed for ${email}:`, error.message);

      // Only need to rollback auth user — DB operations are atomic via RPC
      if (authUserId) {
        try {
          console.log(`🔄 Rolling back auth user: ${authUserId}`);
          await supabase.auth.admin.deleteUser(authUserId);
          console.log('✅ Auth rollback completed');
        } catch (rollbackError) {
          console.error('❌ Auth rollback failed:', rollbackError.message);
        }
      }

      throw error;
    }
  }
}

module.exports = new AgentService();
