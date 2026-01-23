const supabase = require("../helpers/supabaseClient");

class QueueService {
  constructor() {
    this.departmentCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get unassigned chat groups (queue) - Optimized with proper relationships
   */
  async getUnassignedChatGroups(userId) {
    // First get user's department IDs with caching
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
  }

  /**
   * Get profile images for multiple profile IDs - Optimized single query
   */
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

  /**
   * Get latest message timestamp for chat groups - Optimized query
   */
  async getLatestMessageTimes(chatGroupIds) {
    if (!chatGroupIds || chatGroupIds.length === 0) return {};

    // Optimized query with proper ordering to get latest message per group
    const { data: messages, error } = await supabase
      .from("chat")
      .select("chat_group_id, chat_created_at")
      .in("chat_group_id", chatGroupIds)
      .not("client_id", "is", null) // Only get messages from clients
      .order("chat_group_id, chat_created_at");

    if (error) throw error;

    // Create a map of chat_group_id to latest message time
    const timeMap = {};
    const processedGroups = new Set();

    // Process messages - first occurrence per group will be the latest
    (messages || []).forEach((msg) => {
      if (!processedGroups.has(msg.chat_group_id)) {
        timeMap[msg.chat_group_id] = msg.chat_created_at;
        processedGroups.add(msg.chat_group_id);
      }
    });

    return timeMap;
  }

  /**
   * Get cached user departments to avoid repeated queries
   */
  async getCachedUserDepartments(userId) {
    const cacheKey = `user_depts_${userId}`;
    const cached = this.departmentCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    const { data: userDepartments, error } = await supabase
      .from("sys_user_department")
      .select("dept_id")
      .eq("sys_user_id", userId);

    if (error) throw error;

    const deptIds = (userDepartments || []).map(d => d.dept_id);
    
    this.departmentCache.set(cacheKey, {
      data: deptIds,
      timestamp: Date.now()
    });

    return deptIds;
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

    return data;
  }

  /**
   * Check if user is assigned to chat group
   */
  async checkUserChatGroupLink(userId, chatGroupId) {
    const { data, error } = await supabase
      .from("chat_group")
      .select("chat_group_id")
      .eq("sys_user_id", userId)
      .eq("chat_group_id", chatGroupId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Clear department cache for a specific user or all users
   */
  clearDepartmentCache(userId = null) {
    if (userId) {
      this.departmentCache.delete(`user_depts_${userId}`);
    } else {
      this.departmentCache.clear();
    }
  }

  /**
   * Get chat messages with pagination and sender information
   */
  async getChatMessages(clientId, groupIdsToFetch, before = null, limit = 10, currentUserId = null) {
    let query = supabase
      .from("chat")
      .select(`
        *,
        sys_user:sys_user(
          sys_user_id,
          profile:profile(prof_firstname, prof_lastname)
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

    // Deduplicate messages
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
        sender_name: this.getSenderName(msg)
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
}

module.exports = new QueueService();
