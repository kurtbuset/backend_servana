const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");
const agentAssignmentService = require("./agentAssignment.service");
const { CHAT_STATUS } = require("../constants/statuses");
const { getProfileImages, getLatestMessageTimes, determineSenderType, getSenderName, getSenderImageOptimized } = require("../utils/messageHelpers");

class QueueService {
  constructor() {
    // Using centralized cache manager now
  }

  /**
   * Get unassigned chat groups (queue) - Optimized with caching
   */
  async getUnassignedChatGroups(userId) {
    try {
      // Get user's department IDs with caching
      const userDeptIds = await this.getCachedUserDepartments(userId);
      
      if (!userDeptIds || userDeptIds.length === 0) {
        return [];
      }

      // Single optimized query for chat groups in user's departments (queued + transferred)
      const { data: groups, error } = await supabase
        .from("chat_group")
        .select(`
          chat_group_id,
          dept_id,
          status,
          department:department(dept_name),
          client:client!chat_group_client_id_fkey(
            client_id,
            client_number,
            prof_id,
            profile:profile(
              prof_firstname,
              prof_lastname
            )
          )
        `)
        .or(`status.eq.queued,and(status.eq.queued,sys_user_id.is.null)`)
        .in("dept_id", userDeptIds)
        .not("client_id", "is", null); // Only groups with clients

      if (error) throw error;
      return groups || [];
    } catch (error) {
      console.error('❌ Error fetching unassigned chat groups:', error.message);
      throw error;
    }
  }

  // getProfileImages and getLatestMessageTimes moved to utils/messageHelpers.js

  /**
   * Get cached user departments using Redis
   */
  async getCachedUserDepartments(userId) {
    try {
      const cacheKey = `user_depts_${userId}`;
      let deptIds = await cacheService.cache.get('USER_PROFILE', cacheKey);
      
      if (!deptIds) {
        // Cache miss - fetch from database
        const { data: userDepartments, error } = await supabase
          .from("sys_user_department")
          .select("dept_id")
          .eq("sys_user_id", userId);

        if (error) throw error;

        deptIds = (userDepartments || []).map(d => d.dept_id);
        
        // Cache for 10 minutes (departments don't change often)
        await cacheService.cache.set('USER_PROFILE', cacheKey, deptIds, 600);
      }

      return deptIds;
    } catch (error) {
      console.error('❌ Error getting user departments:', error.message);
      return [];
    }
  }

  /**
   * Get chat groups for a client
   */
  async getChatGroupsByClient(clientId) {
    const { data: groups, error } = await supabase
      .from("chat_group")
      .select("chat_group_id")
      .eq("client_id", clientId);

    if (error) throw error;
    return groups || [];
  }

  /**
   * Accept chat from queue - delegates core assignment to agentAssignmentService
   */
  async acceptChat(chatGroupId, userId) {
    try {
      const data = await agentAssignmentService.assignChatGroupToAgent(
        chatGroupId, userId, { requiredStatus: CHAT_STATUS.QUEUED }
      );

      // Also invalidate user's chat groups cache (specific to manual acceptance)
      const userCacheKey = `user_chat_groups_${userId}`;
      await cacheService.cache.delete('CHAT_GROUP', userCacheKey);

      return data;
    } catch (error) {
      console.error('❌ Error accepting chat:', error.message);
      throw error;
    }
  }

  /**
   * Get chat group details for socket notifications
   */
  async getChatGroupDetails(chatGroupId) {
    try {
      const { data, error } = await supabase
        .from("chat_group")
        .select(`
          chat_group_id,
          dept_id,
          client_id,
          sys_user_id,
          status,
          department:department(dept_name),
          client:client!chat_group_client_id_fkey(
            client_id,
            client_number,
            prof_id,
            profile:profile(
              prof_firstname,
              prof_lastname
            )
          )
        `)
        .eq("chat_group_id", chatGroupId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ Error getting chat group details:', error.message);
      return null;
    }
  }

  /**
   * Clear department cache for a specific user
   */
  async clearDepartmentCache(userId = null) {
    try {
      if (userId) {
        const cacheKey = `user_depts_${userId}`;
        await cacheService.cache.delete('USER_PROFILE', cacheKey);
      } else {
        // Clear all user department caches (would need pattern delete)
        console.log('🧹 Individual user department caches will expire naturally');
      }
    } catch (error) {
      console.error('❌ Error clearing department cache:', error.message);
    }
  }

  /**
   * Get chat messages with pagination and sender information - Optimized with profile images
   */
  async getChatMessages(clientId, groupIdsToFetch, before = null, limit = 10, currentUserId = null) {
    // Single optimized query with all necessary joins
    let query = supabase
      .from("chat")
      .select(`
        chat_id,
        chat_body,
        chat_created_at,
        chat_group_id,
        client_id,
        sys_user_id,
        sys_user:sys_user(
          sys_user_id,
          prof_id,
          profile:profile(
            prof_firstname, 
            prof_lastname,
            image:image!prof_id(
              img_location,
              img_is_current
            )
          )
        ),
        client:client(
          client_id,
          prof_id,
          profile:profile(
            prof_firstname,
            prof_lastname,
            image:image!prof_id(
              img_location,
              img_is_current
            )
          )
        )
      `)
      .or(
        [
          `client_id.eq.${clientId}`,
          groupIdsToFetch.length > 0
            ? `chat_group_id.in.(${groupIdsToFetch.join(",")})`
            : "chat_group_id.eq.0",
        ].join(",")
      )
      .order("chat_created_at", { ascending: false })
      .limit(parseInt(limit, 10));

    if (before) {
      query = query.lt("chat_created_at", before);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    // Deduplicate messages and process in single pass
    const seen = new Set();
    const messages = (rows || [])
      .filter((r) => {
        if (seen.has(r.chat_id)) return false;
        seen.add(r.chat_id);
        return true;
      })
      .map((msg) => ({
        ...msg,
        sender_type: determineSenderType(msg, currentUserId),
        sender_name: getSenderName(msg),
        sender_image: getSenderImageOptimized(msg)
      }))
      .reverse();

    return messages;
  }

  // determineSenderType, getSenderName, getSenderImageOptimized moved to utils/messageHelpers.js
}

module.exports = new QueueService();
