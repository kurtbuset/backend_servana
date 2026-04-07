const supabase = require("../../helpers/supabaseClient");
const agentAssignmentService = require("../agentAssignment.service");
const cacheService = require("../cache.service");

class MobileMessageService {
  /**
   * Create a new message
   * Invalidates cache for the chat group
   */
  async createMessage(chatBody, clientId, chatGroupId) {
    // Verify chat group exists and is not resolved
    const { data: chatGroup, error: groupError } = await supabase
      .from("chat_group")
      .select("chat_group_id, status")
      .eq("chat_group_id", chatGroupId)
      .single();

    if (groupError) {
      throw new Error("Chat group not found");
    }

    if (chatGroup.status === "resolved") {
      throw new Error("Cannot send messages to a resolved chat");
    }

    const { data, error } = await supabase
      .from("chat")
      .insert([
        {
          chat_body: chatBody,
          client_id: clientId,
          chat_group_id: chatGroupId,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    await cacheService.invalidateChatMessages(chatGroupId);

    return data;
  }

  /**
   * Get messages by chat group ID with pagination
   * Includes transfer logs and sender type detection (matches web implementation)
   * Uses caching with pagination support
   * @param {number} chatGroupId - The chat group ID
   * @param {string} before - ISO timestamp for pagination (optional)
   * @param {number} limit - Number of messages to fetch (default: 30, max: 100)
   * @param {number} currentClientId - Current client ID for sender type detection (optional)
   * @returns {Promise<Object>} Object containing messages array and pagination info
   */
  async getMessagesByGroupId(
    chatGroupId,
    before = null,
    limit = 30,
    currentClientId = null,
  ) {
    // Enforce limit bounds for performance
    const MAX_LIMIT = 100;
    const safeLimit = Math.min(parseInt(limit, 10), MAX_LIMIT);

    console.log('safeLimit: ', safeLimit)

    const shouldCache = !before;
    // Try to get from cache (only for first page and if limit <= 50)
    if (shouldCache && safeLimit <= 50) {
      const cachedData = await cacheService.getChatMessages(chatGroupId);
      if (cachedData && cachedData.length > 0) {
        console.log('✅ Cache hit for chat messages');
        
        // Sort DESC (newest first), take requested amount, then reverse to ASC
        cachedData.sort((a, b) => new Date(b.chat_created_at) - new Date(a.chat_created_at));
        const limitedMessages = cachedData.slice(0, safeLimit);
        
        // Process cached messages to match expected format
        const processedMessages = limitedMessages.map((msg) => {
          if (msg.message_type === "transfer") {
            return msg;
          }
          return {
            ...msg,
            sender_type: this.determineSenderType(msg, currentClientId),
            sender_name: this.getSenderName(msg),
            sender_image: this.getSenderImageOptimized(msg),
          };
        }).reverse(); // Reverse to ASC (oldest first) for UI display

        return {
          messages: processedMessages,
          hasMore: cachedData.length >= safeLimit,
          count: processedMessages.length,
          oldestTimestamp: processedMessages.length > 0 ? processedMessages[0].chat_created_at : null,
          newestTimestamp: processedMessages.length > 0 ? processedMessages[processedMessages.length - 1].chat_created_at : null,
        };
      }
      console.log(`⚠️ Cache miss for chat messages`);
    }

    let query = supabase
      .from("chat")
      .select(
        `
        chat_id,
        chat_body,
        chat_created_at,
        chat_delivered_at,
        chat_read_at,
        sys_user_id,
        client_id,
        chat_group_id,
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
      `,
      )
      .eq("chat_group_id", chatGroupId)
      .order("chat_created_at", { ascending: false }) // Get newest first for pagination
      .limit(safeLimit);

    // Add pagination filter if 'before' timestamp is provided
    if (before) {
      query = query.lt("chat_created_at", before);
    }

    const { data: rows, error } = await query;

    if (error) throw error;

    // Fetch transfer logs for this chat group
    const { data: transfers, error: transferErr } = await supabase
      .from("chat_transfer_log")
      .select(
        `
        transfer_id,
        transferred_at,
        transfer_type,
        from_dept:department!from_dept_id(dept_name),
        to_dept:department!to_dept_id(dept_name),
        to_agent:sys_user!to_agent_id(
          sys_user_id,
          profile:profile(prof_firstname, prof_lastname)
        )
      `,
      )
      .eq("chat_group_id", chatGroupId)
      .order("transferred_at", { ascending: false });

    if (transferErr) {
      console.error("⚠️ Error fetching transfer logs:", transferErr);
    }

    // Convert transfers to message format
    const transferMessages = (transfers || []).map((transfer) => {
      let transferText = "";
      const toDept = transfer.to_dept?.dept_name || "Unknown Department";
      const toAgent = transfer.to_agent?.profile
        ? `${transfer.to_agent.profile.prof_firstname} ${transfer.to_agent.profile.prof_lastname}`.trim()
        : null;

      // Handle transfer_type (default to 'manual' if null for backward compatibility)
      const transferType = transfer.transfer_type || "manual";

      if (transferType === "manual") {
        transferText = `Chat transferred to ${toDept}`;
      } else if (transferType === "agent_offline") {
        transferText = "Chat reassigned (previous agent went offline)";
      } else {
        transferText = "Chat transferred";
      }

      return {
        chat_id: `transfer_${transfer.transfer_id}`,
        chat_body: transferText,
        chat_created_at: transfer.transferred_at,
        chat_group_id: chatGroupId,
        sender_type: "system",
        message_type: "transfer",
        transfer_data: {
          transfer_id: transfer.transfer_id,
          transfer_type: transferType,
          to_dept: toDept,
          to_agent: toAgent,
        },
      };
    });

    // Merge messages and transfers, then sort by timestamp (ascending - oldest first)
    const allMessages = [...(rows || []), ...transferMessages];
    allMessages.sort(
      (a, b) => new Date(a.chat_created_at) - new Date(b.chat_created_at),
    );

    // Apply pagination filter if needed
    let filteredMessages = allMessages;
    if (before) {
      filteredMessages = allMessages.filter(
        (msg) => new Date(msg.chat_created_at) < new Date(before),
      );
    }

    // Limit results - take the last N messages (most recent)
    filteredMessages = filteredMessages.slice(-safeLimit);

    // Process messages (skip transfer messages as they're already formatted)
    const messages = filteredMessages.map((msg) => {
      if (msg.message_type === "transfer") {
        return msg;
      }
      return {
        ...msg,
        sender_type: this.determineSenderType(msg, currentClientId),
        sender_name: this.getSenderName(msg),
        sender_image: this.getSenderImageOptimized(msg),
      };
    });

    // Messages are already in ascending order (oldest first) for UI display

    const result = {
      messages: messages,
      hasMore: rows.length === safeLimit, // If we got the full limit, there might be more
      count: messages.length,
      oldestTimestamp: messages.length > 0 ? messages[0].chat_created_at : null,
      newestTimestamp:
        messages.length > 0
          ? messages[messages.length - 1].chat_created_at
          : null,
    };

    // Cache the result (only for first page) with 2-minute TTL
    // Always cache up to 50 messages for consistency with web service
    if (shouldCache && messages.length > 0) {
      await cacheService.cacheChatMessages(chatGroupId, messages);
      console.log(`💾 Cached chat messages: ${chatGroupId} (${messages.length} messages)`);
    }

    return result;
  }

  /**
   * Determine the type of message sender (client perspective)
   */
  determineSenderType(message, currentClientId) {
    if (message.client_id && !message.sys_user_id) {
      // Message from client
      if (currentClientId && message.client_id === currentClientId) {
        return "current_client"; // Current client's message
      }
      return "client";
    } else if (message.sys_user_id) {
      // Message from agent
      return "agent";
    }
    return "system";
  }

  /**
   * Get sender display name
   */
  getSenderName(message) {
    if (message.client_id && !message.sys_user_id) {
      if (message.client?.profile) {
        const firstName = message.client.profile.prof_firstname || "";
        const lastName = message.client.profile.prof_lastname || "";
        return `${firstName} ${lastName}`.trim() || "Client";
      }
      return "Client";
    } else if (message.sys_user_id && message.sys_user?.profile) {
      const firstName = message.sys_user.profile.prof_firstname || "";
      const lastName = message.sys_user.profile.prof_lastname || "";
      return `${firstName} ${lastName}`.trim() || "Agent";
    } else if (message.sys_user_id) {
      return "Agent";
    }
    return "System";
  }

  /**
   * Get sender profile image using joined data
   */
  getSenderImageOptimized(message) {
    if (
      message.client_id &&
      !message.sys_user_id &&
      message.client?.profile?.image
    ) {
      const images = message.client.profile.image || [];
      const currentImage = images.find((img) => img.img_is_current);
      return currentImage?.img_location || null;
    } else if (message.sys_user_id && message.sys_user?.profile?.image) {
      const images = message.sys_user.profile.image || [];
      const currentImage = images.find((img) => img.img_is_current);
      return currentImage?.img_location || null;
    }
    return null;
  }

  /**
   * Get latest chat group for client
   * Only returns ACTIVE chat groups (not resolved ones)
   * This ensures clients always start fresh chats after resolution
   */
  async getLatestChatGroup(clientId) {
    const { data: group, error } = await supabase
      .from("chat_group")
      .select("chat_group_id, status")
      .eq("client_id", clientId)
      .neq("status", "resolved") // Exclude resolved chats
      .order("chat_group_id", { ascending: false })
      .limit(1)
      .single();

    if (error || !group) {
      throw new Error("Could not retrieve active chat group");
    }

    return group;
  }

  /**
   * Create a new chat group with auto-assignment
   */
  async createChatGroup(department, clientId) {
    const { data, error } = await supabase
      .from("chat_group")
      .insert([
        {
          dept_id: department,
          client_id: clientId,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    const chatGroupId = data.chat_group_id;

    // Auto-assign to available agent or keep queued
    try {
      const assignmentResult = await agentAssignmentService.autoAssignChatGroup(
        chatGroupId,
        department,
      );

      return {
        chat_group_id: chatGroupId,
        assigned: assignmentResult.assigned,
        status: assignmentResult.status,
        agent_id: assignmentResult.agentId || null,
        department,
      };
    } catch (assignError) {
      console.error("❌ Error auto-assigning chat group:", assignError.message);
      // Return chat group ID even if assignment fails
      return {
        chat_group_id: chatGroupId,
        assigned: false,
        status: "queued",
        agent_id: null,
        department,
      };
    }
  }

  /**
   * End/resolve a chat group (mobile client initiated)
   */
  async endChatGroup(chatGroupId, clientId, feedbackData = {}) {
    try {
      // First verify the chat group belongs to this client
      const { data: chatGroup, error: verifyError } = await supabase
        .from("chat_group")
        .select("chat_group_id, client_id, status, sys_user_id")
        .eq("chat_group_id", chatGroupId)
        .eq("client_id", clientId)
        .single();

      if (verifyError || !chatGroup) {
        throw new Error("Chat group not found or access denied");
      }

      if (chatGroup.status === "resolved") {
        throw new Error("Chat group is already resolved");
      }

      // Update chat group status to resolved
      const { data: updatedGroup, error: updateError } = await supabase
        .from("chat_group")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
        })
        .eq("chat_group_id", chatGroupId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Invalidate agent's chat groups cache if chat was assigned
      if (chatGroup.sys_user_id) {
        await cacheService.invalidateUserChatGroups(chatGroup.sys_user_id);
        await cacheService.invalidateResolvedUserChatGroups(
          chatGroup.sys_user_id,
        );
      }

      // Invalidate chat messages cache
      await cacheService.invalidateChatMessages(chatGroupId);

      // Store feedback if provided
      let feedbackRecord = null;
      if (feedbackData.rating || feedbackData.feedback) {
        console.log("💾 Storing feedback:", {
          rating: feedbackData.rating,
          feedback: feedbackData.feedback ? "provided" : "none",
          duration: feedbackData.chatDurationSeconds,
          messageCount: feedbackData.messageCount,
        });

        const { data: feedback, error: feedbackError } = await supabase
          .from("chat_feedback")
          .insert({
            chat_group_id: chatGroupId,
            client_id: clientId,
            rating: feedbackData.rating || null,
            feedback_text: feedbackData.feedback || null,
          })
          .select()
          .single();

        if (feedbackError) {
          console.warn("⚠️ Failed to save feedback:", feedbackError.message);
        } else {
          feedbackRecord = feedback;
          console.log("✅ Feedback saved successfully:", feedback);

          if (updateError) {
            console.warn(
              "⚠️ Failed to link feedback to chat group:",
              updateError.message,
            );
          }
        }
      } else {
        console.log("ℹ️ No feedback provided by client");
      }

      return {
        chat_group_id: updatedGroup.chat_group_id,
        status: updatedGroup.status,
        resolved_at: updatedGroup.resolved_at,
        feedback: feedbackRecord,
      };
    } catch (error) {
      console.error("❌ Error ending chat group:", error.message);
      throw error;
    }
  }

  /**
   * Get resolved chat history for client
   */
  async getResolvedChats(clientId) {
    try {
      const { data: resolvedChats, error } = await supabase
        .from("chat_group")
        .select(
          `
          chat_group_id,
          resolved_at,
          created_at,
          department:department(dept_name)
        `,
        )
        .eq("client_id", clientId)
        .eq("status", "resolved")
        .order("resolved_at", { ascending: false });

      if (error) throw error;

      // Format the response
      const formattedChats = resolvedChats.map((chat) => ({
        chat_group_id: chat.chat_group_id,
        department: chat.department?.dept_name || "Unknown Department",
        resolved_at: chat.resolved_at,
        created_at: chat.created_at,
        rating: chat.chat_feedback?.rating || null,
        feedback: chat.chat_feedback?.feedback_text || null,
        message_count: chat.chat_feedback?.message_count || 0,
      }));

      return formattedChats;
    } catch (error) {
      console.error("❌ Error fetching resolved chats:", error.message);
      throw error;
    }
  }
}

module.exports = new MobileMessageService();
