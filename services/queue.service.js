const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");

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
        .or(`and(status.eq.queued,sys_user_id.is.null),and(status.eq.transferred,sys_user_id.is.null)`)
        .in("dept_id", userDeptIds)
        .not("client_id", "is", null); // Only groups with clients

      if (error) throw error;
      return groups || [];
    } catch (error) {
      console.error('❌ Error fetching unassigned chat groups:', error.message);
      return [];
    }
  }

  async getProfileImages(profIds) {
    if (!profIds || profIds.length === 0) return {};

    // Single query with proper ordering to get current images first, then latest
    const { data: images, error } = await supabase
      .from("image")
      .select("prof_id, img_location, img_is_current, img_created_at")
      .in("prof_id", profIds)
      .order("prof_id, img_is_current, img_created_at");

    if (error) throw error;

    const imageMap = {};
    const processedProfiles = new Set();

    // Process images - first occurrence per profile will be the best match
    (images || []).forEach((img) => {
      if (!processedProfiles.has(img.prof_id)) {
        imageMap[img.prof_id] = img.img_location;
        processedProfiles.add(img.prof_id);
      }
    });

    return imageMap;
  }

  async getLatestMessageTimes(chatGroupIds) {
    if (!chatGroupIds || chatGroupIds.length === 0) return {};

    // Optimized query to get latest message per group, sorted by newest first
    const { data: messages, error } = await supabase
      .from("chat")
      .select("chat_group_id, chat_created_at")
      .in("chat_group_id", chatGroupIds)
      .not("client_id", "is", null) // Only get messages from clients
      .order("chat_created_at", { ascending: false }); // Sort by newest first

    if (error) throw error;

    // Create a map of chat_group_id to latest message time
    const timeMap = {};
    const processedGroups = new Set();

    // Process messages - first occurrence per group will be the latest due to sorting
    (messages || []).forEach((msg) => {
      if (!processedGroups.has(msg.chat_group_id)) {
        timeMap[msg.chat_group_id] = msg.chat_created_at;
        processedGroups.add(msg.chat_group_id);
      }
    });

    return timeMap;
  }

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
   * Assign chat group to user
   */
  async assignChatGroupToUser(chatGroupId, userId) {
    const { error } = await supabase
      .from("chat_group")
      .update({ sys_user_id: userId })
      .eq("chat_group_id", chatGroupId)
      .is("sys_user_id", null); // avoid overwriting if already set

    if (error) throw error;
  }

  /**
   * Accept chat - assign to user and set status to active
   */
  async acceptChat(chatGroupId, userId) {
    try {
      const { data, error } = await supabase
        .from("chat_group")
        .update({ 
          sys_user_id: userId,
          status: "active"
        })
        .eq("chat_group_id", chatGroupId)
        .in("status", ["queued", "transferred"]) // Accept both queued and transferred chats
        .is("sys_user_id", null)
        .select()
        .single();

      if (error) throw error;
      
      if (!data) {
        throw new Error("Chat group not found or already assigned");
      }

      // Invalidate related caches
      await cacheService.invalidateChatGroup(chatGroupId);
      
      // Invalidate user's chat groups cache
      const userCacheKey = `user_chat_groups_${userId}`;
      await cacheService.cache.delete('CHAT_GROUP', userCacheKey);

      return data;
    } catch (error) {
      console.error('❌ Error accepting chat:', error.message);
      throw error;
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
        sender_type: this.determineSenderType(msg, currentUserId),
        sender_name: this.getSenderName(msg),
        sender_image: this.getSenderImageOptimized(msg)
      }))
      .reverse();

    return messages;
  }

  /**
   * Determine the type of message sender
   */
  determineSenderType(message, currentUserId) {
    if (message.client_id && !message.sys_user_id) {
      return 'client';
    } else if (message.sys_user_id) {
      if (currentUserId && message.sys_user_id === currentUserId) {
        return 'current_agent';
      } else {
        return 'previous_agent';
      }
    }
    return 'system';
  }

  /**
   * Get sender display name
   */
  getSenderName(message) {
    if (message.client_id && !message.sys_user_id) {
      return 'Client';
    } else if (message.sys_user_id && message.sys_user?.profile) {
      const firstName = message.sys_user.profile.prof_firstname || '';
      const lastName = message.sys_user.profile.prof_lastname || '';
      return `${firstName} ${lastName}`.trim() || 'Agent';
    } else if (message.sys_user_id) {
      return 'Agent';
    }
    return 'System';
  }

  /**
   * Get sender profile image - Optimized version using joined data
   */
  getSenderImageOptimized(message) {
    if (message.client_id && !message.sys_user_id && message.client?.profile?.image) {
      // Client message - get current image from joined data
      const images = message.client.profile.image || [];
      const currentImage = images.find(img => img.img_is_current);
      return currentImage?.img_location || null;
    } else if (message.sys_user_id && message.sys_user?.profile?.image) {
      // Agent message - get current image from joined data
      const images = message.sys_user.profile.image || [];
      const currentImage = images.find(img => img.img_is_current);
      return currentImage?.img_location || null;
    }
    return null;
  }
}

module.exports = new QueueService();
