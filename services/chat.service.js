const supabase = require("../helpers/supabaseClient");
const cookie = require("cookie");

class ChatService {
  constructor() {
    this.userRoleCache = new Map();
    this.cacheExpiry = 10 * 60 * 1000; // 10 minutes for user roles (stable data)
  }

  /**
   * Get canned messages for a specific role
   */
  async getCannedMessagesByRole(roleId) {
    const { data: messages, error } = await supabase
      .from("canned_message")
      .select("canned_id, canned_message")
      .eq("role_id", roleId)
      .eq("canned_is_active", true);

    if (error) throw error;
    return messages;
  }

  /**
   * Get user's role ID with caching
   */
  async getUserRole(userId) {
    const cacheKey = `user_role_${userId}`;
    const cached = this.userRoleCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    const { data: userData, error: userError } = await supabase
      .from("sys_user")
      .select("role_id")
      .eq("sys_user_id", userId)
      .single();

    if (userError || !userData) {
      throw new Error("User not found or no role.");
    }

    // Cache the role ID
    this.userRoleCache.set(cacheKey, {
      data: userData.role_id,
      timestamp: Date.now()
    });

    return userData.role_id;
  }

  /**
   * Get all active chat groups for a user (only active chats)
   */
  async getChatGroupsByUser(userId) {
    // Get only active chats assigned to user
    const { data: groups, error } = await supabase
      .from("chat_group")
      .select(`
        chat_group_id,
        dept_id,
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
      .eq("status", "active")
      .eq("sys_user_id", userId);

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
   * Get chat groups by client ID
   */
  async getChatGroupsByClient(clientId) {
    const { data: groups, error: groupsErr } = await supabase
      .from("chat_group")
      .select("chat_group_id")
      .eq("client_id", clientId);

    if (groupsErr) throw groupsErr;
    return groups || [];
  }

  /**
   * Get chat messages with pagination and sender information
   */
  async getChatMessages(clientId, before = null, limit = 10, currentUserId = null) {
    const groups = await this.getChatGroupsByClient(clientId);
    
    if (groups.length === 0) {
      throw new Error("Chat group not found");
    }

    const groupIds = groups.map((g) => g.chat_group_id);

    let query = supabase
      .from("chat")
      .select(`
        *,
        sys_user:sys_user(
          sys_user_id,
          profile:profile(prof_firstname, prof_lastname)
        )
      `)
      .or([
        `client_id.eq.${clientId}`,
        `chat_group_id.in.(${groupIds.join(",")})`,
      ].join(","))
      .order("chat_created_at", { ascending: false })
      .limit(parseInt(limit, 10));

    if (before) {
      query = query.lt("chat_created_at", before);
    }

    const { data: rows, error: chatErr } = await query;
    if (chatErr) throw chatErr;

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

  /**
   * Authenticate user from socket handshake
   */
  async authenticateSocketUser(socket) {
    const cookies = cookie.parse(socket.handshake.headers.cookie || "");
    const token = cookies.access_token;

    if (!token) {
      throw new Error("No access token found in cookies");
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new Error("Invalid token");
    }

    // Map supabase user to system_user
    const { data: userData, error: userFetchError } = await supabase
      .from("sys_user")
      .select("sys_user_id")
      .eq("supabase_user_id", user.id)
      .single();

    if (userFetchError || !userData) {
      throw new Error("Failed to fetch system_user");
    }

    return userData.sys_user_id;
  }

  /**
   * Clear user role cache for a specific user or all users
   */
  clearUserRoleCache(userId = null) {
    if (userId) {
      this.userRoleCache.delete(`user_role_${userId}`);
    } else {
      this.userRoleCache.clear();
    }
  }

  /**
   * Insert a new chat message
   */
  async insertMessage(messageData) {
    const { data, error: insertError } = await supabase
      .from("chat")
      .insert([messageData])
      .select("*");

    if (insertError) throw insertError;
    return data && data.length > 0 ? data[0] : null;
  }

  /**
   * Transfer chat group to another department
   */
  async transferChatGroup(chatGroupId, deptId, userId) {
    const { data, error } = await supabase
      .from("chat_group")
      .update({
        status: "transferred",
        sys_user_id: null,
        dept_id: deptId
      })
      .eq("chat_group_id", chatGroupId)
      .eq("sys_user_id", userId) // Ensure only the assigned user can transfer
      .select()
      .single();

    if (error) throw error;
    
    if (!data) {
      throw new Error("Chat group not found or you don't have permission to transfer it");
    }

    return data;
  }
}

module.exports = new ChatService();
