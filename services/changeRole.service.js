const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");

class ChangeRoleService {
  /**
   * Get all users with their roles and profile pictures - Redis caching with 1-hour TTL
   * Cache-first approach: if cache found, return cache data; if not, use business logic for data fetching
   */
  async getAllUsersWithRoles() {
    try {
      // Try to get from cache first
      const cachedUsersWithRoles = await cacheService.getUsersWithRoles();
      
      if (cachedUsersWithRoles !== null && cachedUsersWithRoles !== undefined) {
        console.log(`✅ Cache HIT: Retrieved ${cachedUsersWithRoles.length} users with roles from Redis cache`);
        return cachedUsersWithRoles;
      }
      
      // Cache miss - use business logic for data fetching
      console.log('⚠️ Cache MISS: Fetching users with roles from database');
      
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

      // Cache the result for future requests with 1-hour TTL
      await cacheService.updateUsersWithRoles(response);
      console.log(`✅ Cached ${response.length} users with roles with 1-hour TTL using write-through strategy`);

      return response;
    } catch (error) {
      console.error("❌ Error in getAllUsersWithRoles:", error.message);
      
      // Fallback: try to return stale cache data if available
      try {
        const staleCachedData = await cacheService.getUsersWithRoles();
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
   * Get all roles (active + inactive) - Redis caching with 24-hour TTL
   * Cache-first approach: if cache found, return cache data; if not, use business logic for data fetching
   */
  async getAllRoles() {
    try {
      // Try to get from role cache first (reuse existing role cache)
      const cachedRoles = await cacheService.getRoles();
      
      if (cachedRoles !== null && cachedRoles !== undefined) {
        console.log(`✅ Cache HIT: Retrieved ${cachedRoles.length} roles from Redis cache`);
        return cachedRoles;
      }
      
      // Cache miss - use business logic for data fetching
      console.log('⚠️ Cache MISS: Fetching roles from database');
      const { data, error } = await supabase
        .from("role")
        .select("role_id, role_name, role_is_active")
        .order("role_name", { ascending: true });

      if (error) throw error;
      
      // Cache the result for future requests with 24-hour TTL
      if (data) {
        await cacheService.updateRoles(data);
        console.log(`✅ Cached ${data.length} roles with 24-hour TTL using write-through strategy`);
      }
      
      return data || [];
    } catch (error) {
      console.error("❌ Error in getAllRoles:", error.message);
      
      // Fallback: try to return stale cache data if available
      try {
        const staleCachedData = await cacheService.getRoles();
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
   * Update user's role or active status - Write-through caching
   */
  async updateUserRole(userId, roleId, isActive, updatedBy) {
    try {
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
      
      // Invalidate caches after successful update
      await cacheService.invalidateUsersWithRoles();
      await cacheService.invalidateAgents(); // User role changes affect agent listings
      console.log("🧹 Invalidated users with roles and agents cache after user role update");
      
      return data;
    } catch (error) {
      console.error("❌ Error in updateUserRole:", error.message);
      throw error;
    }
  }
}

module.exports = new ChangeRoleService();
