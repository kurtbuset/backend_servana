const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");
const cookie = require("cookie");
const agentAssignmentService = require("./agentAssignment.service");

class ChatService {
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
   * Get resolved chat groups for a user
   */
  async getResolvedChatGroupsByUser(userId) {
    try {
      // Cache key for resolved chats
      const cacheKey = `user_resolved_chat_groups_${userId}`;
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
          .eq("status", "resolved")
          .eq("sys_user_id", userId);

        if (error) throw error;
        
        groups = data || [];
        
        // Cache for 5 minutes
        await cacheService.cache.set('CHAT_GROUP', cacheKey, groups, 300);
      }
      
      return groups;
    } catch (error) {
      console.error('❌ Error fetching resolved chat groups:', error.message);
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
  async getChatMessages(messageId, before = null, limit = 10, currentUserId = null) {
    try {
      // messageId can be either a chat_group_id or client_id
      // First try to use it as chat_group_id, if that fails, treat as client_id
      
      let chatGroupId = null;
      
      // Check if messageId is a chat_group_id
      const { data: directChatGroup, error: directError } = await supabase
        .from("chat_group")
        .select("chat_group_id, client_id, status")
        .eq("chat_group_id", messageId)
        .single();
      
      if (!directError && directChatGroup) {
        // messageId is a chat_group_id - use it directly
        chatGroupId = directChatGroup.chat_group_id;
        console.log(`✅ Using specific chat group ID: ${chatGroupId}`);
      } else {
        // messageId is a client_id - find the most recent active chat group
        const { data: activeGroup, error: groupError } = await supabase
          .from("chat_group")
          .select("chat_group_id, sys_user_id, status, dept_id")
          .eq("client_id", messageId)
          .eq("status", "active") // Only active chats (not resolved)
          .order("chat_group_id", { ascending: false }) // Get most recent
          .limit(1)
          .single();

        if (groupError || !activeGroup) {
          console.log(`❌ No active chat group found for client ${messageId}`);
          return [];
        }

        chatGroupId = activeGroup.chat_group_id;
        console.log(`✅ Using client's most recent active chat group: ${chatGroupId}`);
      }
      
      // Try to get recent messages from cache first
      let cachedMessages = [];
      if (!before && limit <= 50) {
        cachedMessages = await cacheService.getChatMessages(chatGroupId);
        
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
          chat_delivered_at,
          chat_read_at,
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
        .eq("chat_group_id", chatGroupId) // Only messages from this specific chat group
        .order("chat_created_at", { ascending: false })
        .limit(parseInt(limit, 10));

      if (before) {
        query = query.lt("chat_created_at", before);
      }

      const { data: rows, error: chatErr } = await query;
      if (chatErr) throw chatErr;

      // Fetch transfer logs for this chat group
      const { data: transfers, error: transferErr } = await supabase
        .from("chat_transfer_log")
        .select(`
          transfer_id,
          transferred_at,
          transfer_type,
          from_dept:department!from_dept_id(dept_name),
          to_dept:department!to_dept_id(dept_name),
          to_agent:sys_user!to_agent_id(
            sys_user_id,
            profile:profile(prof_firstname, prof_lastname)
          )
        `)
        .eq("chat_group_id", chatGroupId)
        .order("transferred_at", { ascending: false });

      if (transferErr) {
        console.error("⚠️ Error fetching transfer logs:", transferErr);
      }

      // Convert transfers to message format
      const transferMessages = (transfers || []).map(transfer => {
        let transferText = '';
        const toDept = transfer.to_dept?.dept_name || 'Unknown Department';
        const toAgent = transfer.to_agent?.profile 
          ? `${transfer.to_agent.profile.prof_firstname} ${transfer.to_agent.profile.prof_lastname}`.trim()
          : null;

        // Handle transfer_type (default to 'manual' if null for backward compatibility)
        const transferType = transfer.transfer_type || 'manual';

        if (transferType === 'manual') {
          transferText = toAgent 
            ? `Chat transferred to ${toDept} - Assigned to ${toAgent}`
            : `Chat transferred to ${toDept}`;
        } else if (transferType === 'auto_reassign') {
          transferText = toAgent
            ? `Chat automatically reassigned to ${toAgent}`
            : 'Chat automatically reassigned';
        } else if (transferType === 'agent_offline') {
          transferText = 'Chat reassigned (previous agent went offline)';
        } else {
          transferText = 'Chat transferred';
        }

        return {
          chat_id: `transfer_${transfer.transfer_id}`,
          chat_body: transferText,
          chat_created_at: transfer.transferred_at,
          chat_group_id: chatGroupId,
          sender_type: 'system',
          message_type: 'transfer',
          transfer_data: {
            transfer_id: transfer.transfer_id,
            transfer_type: transferType,
            to_dept: toDept,
            to_agent: toAgent
          }
        };
      });

      // Merge messages and transfers, then sort by timestamp
      const allMessages = [...(rows || []), ...transferMessages];
      allMessages.sort((a, b) => new Date(a.chat_created_at) - new Date(b.chat_created_at));

      // Apply pagination filter if needed
      let filteredMessages = allMessages;
      if (before) {
        filteredMessages = allMessages.filter(msg => 
          new Date(msg.chat_created_at) < new Date(before)
        );
      }

      // Limit results
      filteredMessages = filteredMessages.slice(-parseInt(limit, 10));

      // Process messages (skip transfer messages as they're already formatted)
      const messages = filteredMessages.map((msg) => {
        if (msg.message_type === 'transfer') {
          return msg;
        }
        return {
          ...msg,
          sender_type: this.determineSenderType(msg, currentUserId),
          sender_name: this.getSenderName(msg),
          sender_image: this.getSenderImageOptimized(msg)
        };
      });

      // Cache recent messages if this was a fresh fetch
      if (!before && messages.length > 0) {
        await cacheService.cacheChatMessages(chatGroupId, messages);
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
      // Verify the chat group exists and user has permission
      const { data: chatGroup, error: fetchError } = await supabase
        .from("chat_group")
        .select("chat_group_id, dept_id, sys_user_id")
        .eq("chat_group_id", chatGroupId)
        .eq("sys_user_id", userId) // Ensure only the assigned user can transfer
        .single();

      if (fetchError || !chatGroup) {
        throw new Error("Chat group not found or you don't have permission to transfer it");
      }

      const fromDeptId = chatGroup.dept_id;
      const fromAgentId = chatGroup.sys_user_id;

      // Log the transfer in chat_transfer_log FIRST (without to_agent_id)
      const { data: transferLog, error: logError } = await supabase
        .from("chat_transfer_log")
        .insert({
          chat_group_id: chatGroupId,
          from_agent_id: fromAgentId,
          to_agent_id: null, // Will be updated if agent is found
          from_dept_id: fromDeptId,
          to_dept_id: deptId,
          transfer_type: "manual",
          transferred_at: new Date().toISOString()
        })
        .select()
        .single();

      if (logError) {
        console.error("⚠️ Failed to log transfer:", logError.message);
        // Don't throw - continue with transfer even if logging fails
      }

      // Update department first (unassign from current agent)
      const { error: updateError } = await supabase
        .from("chat_group")
        .update({
          dept_id: deptId,
          sys_user_id: null
        })
        .eq("chat_group_id", chatGroupId);

      if (updateError) throw updateError;

      // Use round-robin to auto-assign to an available agent in the new department
      const assignmentResult = await agentAssignmentService.autoAssignChatGroup(
        chatGroupId,
        deptId
      );

      console.log(
        `✅ Chat ${chatGroupId} transferred from dept ${fromDeptId} to ${deptId}:`,
        assignmentResult.assigned ? `assigned to agent ${assignmentResult.agentId}` : "queued (no available agents)"
      );

      // If agent was found, UPDATE the transfer log with to_agent_id
      if (assignmentResult.assigned && assignmentResult.agentId && transferLog) {
        const { error: updateLogError } = await supabase
          .from("chat_transfer_log")
          .update({
            to_agent_id: assignmentResult.agentId
          })
          .eq("transfer_id", transferLog.transfer_id);

        if (updateLogError) {
          console.error("⚠️ Failed to update transfer log with to_agent_id:", updateLogError.message);
        } else {
          console.log(`✅ Updated transfer log ${transferLog.transfer_id} with to_agent_id: ${assignmentResult.agentId}`);
        }
      }

      // Fetch the updated chat group
      const { data: updatedChat, error: finalError } = await supabase
        .from("chat_group")
        .select("chat_group_id, dept_id, sys_user_id, status")
        .eq("chat_group_id", chatGroupId)
        .single();

      if (finalError) throw finalError;

      // Invalidate related caches
      await cacheService.invalidateChatGroup(chatGroupId);
      await cacheService.invalidateChatMessages(chatGroupId);
      
      // Invalidate both old and new agent's chat groups cache
      const oldAgentCacheKey = `user_chat_groups_${userId}`;
      await cacheService.cache.delete('CHAT_GROUP', oldAgentCacheKey);
      
      if (assignmentResult.assigned && assignmentResult.agentId) {
        const newAgentCacheKey = `user_chat_groups_${assignmentResult.agentId}`;
        await cacheService.cache.delete('CHAT_GROUP', newAgentCacheKey);
      }

      return {
        ...updatedChat,
        from_dept_id: fromDeptId,
        assignmentResult
      };
    } catch (error) {
      console.error('❌ Error transferring chat group:', error.message);
      throw error;
    }
  }

  /**
   * Resolve chat group (mark as resolved)
   */
  async resolveChatGroup(chatGroupId, userId, feedbackData = {}) {
    try {
      // Start a transaction to handle both chat resolution and feedback
      const { data: chatGroup, error: chatError } = await supabase
        .from("chat_group")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString()
        })
        .eq("chat_group_id", chatGroupId)
        .eq("sys_user_id", userId) // Ensure only the assigned user can resolve
        .select()
        .single();

      if (chatError) throw chatError;
      
      if (!chatGroup) {
        throw new Error("Chat group not found or you don't have permission to resolve it");
      }

      // If feedback data is provided, store it
      let feedbackRecord = null;
      if (feedbackData.rating || feedbackData.feedback) {
        const { data: feedback, error: feedbackError } = await supabase
          .from("chat_feedback")
          .insert({
            chat_group_id: chatGroupId,
            client_id: chatGroup.client_id,
            rating: feedbackData.rating || null,
            feedback_text: feedbackData.feedback || null,
            chat_duration_seconds: feedbackData.chatDurationSeconds || null,
            message_count: feedbackData.messageCount || null
          })
          .select()
          .single();

        if (feedbackError) {
          console.warn('⚠️ Failed to save feedback:', feedbackError.message);
        } else {
          feedbackRecord = feedback;
          
          // Update chat group with feedback reference
          await supabase
            .from("chat_group")
            .update({ feedback_id: feedback.feedback_id })
            .eq("chat_group_id", chatGroupId);
        }
      }

      // Invalidate related caches
      await cacheService.invalidateChatGroup(chatGroupId);
      await cacheService.invalidateChatMessages(chatGroupId);
      
      // Invalidate user's chat groups cache
      const userCacheKey = `user_chat_groups_${userId}`;
      await cacheService.cache.delete('CHAT_GROUP', userCacheKey);

      return {
        ...chatGroup,
        feedback: feedbackRecord
      };
    } catch (error) {
      console.error('❌ Error resolving chat group:', error.message);
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
