const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");

class DepartmentService {
  /**
   * Get all departments - Redis caching with 4-hour TTL and write-through strategy
   * Cache-first approach: if cache found, return cache data; if not, use business logic for data fetching
   */
  async getAllDepartments() {
    try {
      // Try to get from cache first
      const cachedDepartments = await cacheService.getDepartments();
      
      if (cachedDepartments && cachedDepartments.length >= 0) {
        console.log(`✅ Cache HIT: Retrieved ${cachedDepartments.length} departments from Redis cache`);
        return cachedDepartments;
      }
      
      // Cache miss - use business logic for data fetching
      console.log('⚠️ Cache MISS: Fetching departments from database');
      const { data, error } = await supabase
        .from("department")
        .select("*")
        .order("dept_name", { ascending: true });

      if (error) throw error;
      
      // Cache the result for future requests with 4-hour TTL
      if (data) {
        await cacheService.updateDepartments(data);
        console.log(`✅ Cached ${data.length} departments with 4-hour TTL using write-through strategy`);
      }
      
      return data || [];
    } catch (error) {
      console.error('❌ Error in getAllDepartments:', error.message);
      
      // Fallback: try to return stale cache data if available
      try {
        const staleCachedData = await cacheService.getDepartments();
        if (staleCachedData && staleCachedData.length >= 0) {
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
   * Create a new department - Write-through caching
   */
  async createDepartment(deptName, createdBy) {
    try {
      // Write-through: Create in database first
      const { data, error } = await supabase
        .from("department")
        .insert([
          {
            dept_name: deptName,
            dept_created_by: createdBy,
            dept_updated_by: createdBy,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      
      // Invalidate cache to ensure fresh data on next read
      await cacheService.invalidateDepartments();
      await this.invalidateDepartmentMembersCache();
      console.log("🧹 Invalidated departments cache after creation");
      
      return data;
    } catch (error) {
      console.error('❌ Error in createDepartment:', error.message);
      throw error;
    }
  }

  /**
   * Update a department - Write-through caching
   */
  async updateDepartment(deptId, updateData) {
    try {
      // Write-through: Update database first
      const { data, error } = await supabase
        .from("department")
        .update(updateData)
        .eq("dept_id", deptId)
        .select()
        .single();

      if (error) throw error;
      
      // Invalidate cache to ensure fresh data on next read
      await cacheService.invalidateDepartments();
      await this.invalidateDepartmentMembersCache();
      console.log("🧹 Invalidated departments cache after update");
      
      return data;
    } catch (error) {
      console.error('❌ Error in updateDepartment:', error.message);
      throw error;
    }
  }

  /**
   * Toggle department active status - Write-through caching
   */
  async toggleDepartmentStatus(deptId, isActive, updatedBy) {
    try {
      // Write-through: Update database first
      const { data, error } = await supabase
        .from("department")
        .update({
          dept_is_active: isActive,
          dept_updated_at: new Date(),
          dept_updated_by: updatedBy,
        })
        .eq("dept_id", deptId)
        .select()
        .single();

      if (error) throw error;
      
      // Invalidate cache to ensure fresh data on next read
      await cacheService.invalidateDepartments();
      await this.invalidateDepartmentMembersCache();
      console.log("🧹 Invalidated departments cache after status toggle");
      
      return data;
    } catch (error) {
      console.error('❌ Error in toggleDepartmentStatus:', error.message);
      throw error;
    }
  }

  /**
   * Get all members of a department - Redis caching with 30-minute TTL
   * Cache-first approach: if cache found, return cache data; if not, use business logic for data fetching
   */
  async getDepartmentMembers(deptId) {
    try {
      // Try to get from cache first using cache service
      const cacheKey = `members_${deptId}`;
      let cachedMembers = await cacheService.cache.get('DEPARTMENT', cacheKey);
      
      if (cachedMembers !== null && cachedMembers !== undefined) {
        console.log(`✅ Cache HIT: Retrieved ${cachedMembers.length} department members from Redis cache for dept ${deptId}`);
        return cachedMembers;
      }
      
      // Cache miss - use business logic for data fetching
      console.log(`⚠️ Cache MISS: Fetching department members from database for dept ${deptId}`);
      
      const { data: userDepartments, error } = await supabase
        .from("sys_user_department")
        .select(`
          sys_user_id,
          sys_user (
            sys_user_id,
            sys_user_email,
            sys_user_is_active,
            role_id,
            role (
              role_id,
              role_name
            )
          )
        `)
        .eq("dept_id", deptId);

      if (error) {
        console.error("❌ Error fetching department members:", error);
        throw error;
      }

      if (!userDepartments || userDepartments.length === 0) {
        // Cache empty result to avoid repeated database queries
        await cacheService.cache.set('DEPARTMENT', cacheKey, [], 30 * 60); // 30 minutes TTL
        console.log(`✅ Cached empty department members result for dept ${deptId} with 30-minute TTL`);
        return [];
      }

      // Now fetch profile and image data for each user
      const memberPromises = userDepartments
        .filter(ud => ud.sys_user)
        .map(async (ud) => {
          const userId = ud.sys_user.sys_user_id;

          // First get the sys_user to get prof_id and last_seen
          const { data: userWithProf } = await supabase
            .from("sys_user")
            .select("prof_id, last_seen")
            .eq("sys_user_id", userId)
            .single();

          let profile = null;
          let image = null;

          // If user has a prof_id, fetch profile and image
          if (userWithProf?.prof_id) {
            // Fetch profile
            const { data: profileData } = await supabase
              .from("profile")
              .select("*")
              .eq("prof_id", userWithProf.prof_id)
              .single();

            profile = profileData;

            // Fetch current image using prof_id
            const { data: imageData } = await supabase
              .from("image")
              .select("img_id, img_location, img_is_current")
              .eq("prof_id", userWithProf.prof_id)
              .eq("img_is_current", true)
              .single();

            image = imageData;
          }

          // Fetch all departments for this user
          const { data: userDepts } = await supabase
            .from("sys_user_department")
            .select(`
              dept_id,
              department (
                dept_id,
                dept_name
              )
            `)
            .eq("sys_user_id", userId);

          const departments = userDepts?.map(ud => ud.department).filter(Boolean) || [];

          return {
            sys_user_id: ud.sys_user.sys_user_id,
            sys_user_email: ud.sys_user.sys_user_email,
            sys_user_is_active: ud.sys_user.sys_user_is_active,
            role: ud.sys_user.role,
            profile: profile || null,
            image: image || null,
            last_seen: userWithProf?.last_seen || null,
            departments: departments
          };
        });

      const members = await Promise.all(memberPromises);
      
      // Cache the result for 30 minutes (department membership changes moderately)
      await cacheService.cache.set('DEPARTMENT', cacheKey, members, 30 * 60);
      console.log(`✅ Cached ${members.length} department members for dept ${deptId} with 30-minute TTL`);
      
      return members;
    } catch (error) {
      console.error("❌ Exception in getDepartmentMembers:", error);
      
      // Fallback: try to return stale cache data if available
      try {
        const cacheKey = `members_${deptId}`;
        const staleCachedData = await cacheService.cache.get('DEPARTMENT', cacheKey);
        if (staleCachedData !== null && staleCachedData !== undefined) {
          console.log(`⚠️ Returning stale cache data for department members dept ${deptId} due to database error`);
          return staleCachedData;
        }
      } catch (cacheError) {
        console.error('❌ Cache fallback also failed for department members:', cacheError.message);
      }
      
      throw error;
    }
  }

  /**
   * Helper method to invalidate department members cache
   */
  async invalidateDepartmentMembersCache() {
    try {
      // Get all department keys that start with 'members_'
      // Note: This is a simplified approach. In production, you might want to track department IDs
      const keys = await cacheService.cache.client.keys(cacheService.cache.generateKey('DEPARTMENT', 'members_*'));
      
      if (keys && keys.length > 0) {
        await cacheService.cache.client.del(keys);
        console.log(`🧹 Invalidated ${keys.length} department members cache entries`);
      }
    } catch (error) {
      console.error('❌ Error invalidating department members cache:', error.message);
      // Don't throw error as this is a cache operation
    }
  }
}

module.exports = new DepartmentService();
