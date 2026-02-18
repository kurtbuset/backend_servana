const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");
const cookie = require("cookie");

class ChatService {
  constructor() {
    // Using centralized cache manager now
  }

  /**
   * Get canned messages for a specific role filtered by user's assigned departments
   */
  async getCannedMessagesByRole(roleId, userId = null) {
    try {
      const messages = await cacheService.getCannedMessages(roleId, userId);
      console.log(`📝 Found ${messages?.length || 0} canned messages for role ${roleId}${userId ? ` and user ${userId}` : ''}`);
      return messages;
    } catch (error) {
      console.error('❌ Error fetching canned messages:', error.message);
      return [];
    }
  }

  /**
   * Get user's role ID with caching
   */
  async getUserRole(userId) {
    try {
      // Try to get from user profile cache first
      const profile = await cacheService.getUserProfile(userId, 'agent');
      if (profile && profile.role_id) {
        return profile.role_id;
      }

      // Fallback to direct database query
      const { data: userData, error: userError } = await supabase
        .from("sys_user")
        .select("role_id")
        .eq("sys_user_id", userId)
        .single();

      if (userError || !userData) {
        throw new Error("User not found or no role.");
      }

      return userData.role_id;
    } catch (error) {
      console.error('❌ Error fetching user role:', error.message);
      throw error;
    }
  }

  /**
   * Get all active chat groups for a user (only active chats)
   */
  async getChatGroupsByUser(userId) {
    try {
      // Try to get from cache first
      const cacheKey = `user_chat_groups_${userId}`;
      let groups = await cacheService.cache.get('CHAT_GROUP', cacheKey);
      
      if (!groups) {
        // Cache miss - fetch from database
        const { data, error } = await supabase
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
        
        groups = data || [];
        
        // Cache for 5 minutes (chat groups change frequently)
        await cacheService.cache.set('CHAT_GROUP', cacheKey, groups, 300);
      }
      
      return groups;
    } catch (error) {
      console.error('❌ Error fetching chat groups:', error.message);
      return [];
    }
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
   * Get latest message timestamp for chat groups - Optimized query with proper sorting
   */
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
   * Get chat messages with pagination and sender information - Optimized with caching
   */
  async getChatMessages(clientId, before = null, limit = 10, currentUserId = null) {
    try {
      const groups = await this.getChatGroupsByClient(clientId);
      
      if (groups.length === 0) {
        throw new Error("Chat group not found");
      }

      const groupIds = groups.map((g) => g.chat_group_id);
      
      // Try to get recent messages from cache first
      let cachedMessages = [];
      if (!before && limit <= 50) {
        // Only use cache for recent messages (no pagination)
        // OPTIMIZED: Batch cache retrieval using Promise.all instead of sequential loop
        const cachePromises = groupIds.map(groupId => cacheService.getChatMessages(groupId));
        const cachedMessageArrays = await Promise.all(cachePromises);
        
        // Flatten all cached messages
        cachedMessages = cachedMessageArrays.flat();
        
        if (cachedMessages.length > 0) {
          // Sort and limit cached messages
          cachedMessages.sort((a, b) => new Date(b.chat_created_at) - new Date(a.chat_created_at));
          const limitedMessages = cachedMessages.slice(0, limit);
          
          // Process cached messages
          return limitedMessages.map((msg) => ({
            ...msg,
            sender_type: this.determineSenderType(msg, currentUserId),
            sender_name: this.getSenderName(msg),
            sender_image: this.getSenderImageOptimized(msg)
          })).reverse();
        }
      }

      // Cache miss or pagination - fetch from database
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

      // Cache recent messages if this was a fresh fetch
      if (!before && messages.length > 0) {
        // OPTIMIZED: Batch cache storage using Promise.all instead of sequential loop
        const cachePromises = groupIds.map(groupId => {
          const groupMessages = messages.filter(m => m.chat_group_id === groupId);
          if (groupMessages.length > 0) {
            return cacheService.cacheChatMessages(groupId, groupMessages);
          }
          return Promise.resolve(); // Return resolved promise for groups with no messages
        }).filter(promise => promise !== Promise.resolve()); // Remove empty promises

        // Execute all cache operations in parallel
        if (cachePromises.length > 0) {
          await Promise.all(cachePromises);
          console.log(`✅ Cached messages for ${cachePromises.length} chat groups in parallel`);
        }
      }

      return messages;
    } catch (error) {
      console.error('❌ Error fetching chat messages:', error.message);
      throw error;
    }
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

  /**
   * Get sender profile image - Legacy version (kept for compatibility)
   */
  getSenderImage(message, profileImages) {
    if (message.client_id && !message.sys_user_id && message.client?.prof_id) {
      // Client message - get client's profile image
      return profileImages[message.client.prof_id] || null;
    } else if (message.sys_user_id && message.sys_user?.prof_id) {
      // Agent message - get agent's profile image
      return profileImages[message.sys_user.prof_id] || null;
    }
    return null;
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
   * Insert a new chat message
   */
  async insertMessage(messageData) {
    try {
      const { data, error: insertError } = await supabase
        .from("chat")
        .insert([messageData])
        .select("*");

      if (insertError) throw insertError;
      
      const newMessage = data && data.length > 0 ? data[0] : null;
      
      // Invalidate chat message cache for this group
      if (newMessage && newMessage.chat_group_id) {
        await cacheService.invalidateChatMessages(newMessage.chat_group_id);
        
        // Also invalidate user's chat groups cache if they're assigned
        if (newMessage.sys_user_id) {
          const cacheKey = `user_chat_groups_${newMessage.sys_user_id}`;
          await cacheService.cache.delete('CHAT_GROUP', cacheKey);
        }
      }
      
      return newMessage;
    } catch (error) {
      console.error('❌ Error inserting message:', error.message);
      throw error;
    }
  }

  /**
   * Transfer chat group to another department
   */
  async transferChatGroup(chatGroupId, deptId, userId) {
    try {
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

      // Invalidate related caches
      await cacheService.invalidateChatGroup(chatGroupId);
      await cacheService.invalidateChatMessages(chatGroupId);
      
      // Invalidate user's chat groups cache
      const userCacheKey = `user_chat_groups_${userId}`;
      await cacheService.cache.delete('CHAT_GROUP', userCacheKey);

      return data;
    } catch (error) {
      console.error('❌ Error transferring chat group:', error.message);
      throw error;
    }
  }

  /**
   * Clear user-related caches (for cache invalidation)
   */
  async clearUserCache(userId) {
    try {
      await cacheService.invalidateUserProfile(userId, 'agent');
      
      const userCacheKey = `user_chat_groups_${userId}`;
      await cacheService.cache.delete('CHAT_GROUP', userCacheKey);
      
      console.log(`🧹 Cleared cache for user ${userId}`);
    } catch (error) {
      console.error('❌ Error clearing user cache:', error.message);
    }
  }
}

module.exports = new ChatService();
