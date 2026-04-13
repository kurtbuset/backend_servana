const supabase = require("../helpers/supabaseClient");
const cacheService = require("./cache.service");
const agentAssignmentService = require("./agentAssignment.service");
const {
  determineSenderType,
  getSenderName,
  getSenderImageOptimized,
} = require("../utils/messageHelpers");

class ChatService {
  /**
   * Get canned messages for a specific role filtered by user's assigned departments
   */
  async getCannedMessagesByRole(roleId, userId = null) {
    try {
      // Try cache first (cache-aside pattern)
      const cachedMessages = await cacheService.getCannedMessages(roleId, userId);
      
      if (cachedMessages !== null && cachedMessages !== undefined) {
        console.log(`✅ Cache HIT: Retrieved canned messages for role ${roleId}`);
        return cachedMessages;
      }

      console.log(`⚠️ Cache MISS: Fetching canned messages from database for role ${roleId}`);

      // Cache miss - fetch from database
      // Get user's departments if userId is provided
      let userDepartments = [];
      if (userId) {
        const { data: userDepts, error: deptError } = await supabase
          .from("sys_user_department")
          .select("dept_id")
          .eq("sys_user_id", userId);

        if (!deptError && userDepts) {
          userDepartments = userDepts.map(d => d.dept_id);
        }
      }

      // Fetch canned messages for the role
      const { data: messages, error: messagesError } = await supabase
        .from("canned_message")
        .select("canned_id, canned_message, canned_is_active, dept_id, role_id")
        .eq("role_id", roleId)
        .eq("canned_is_active", true) // Only active messages
        .order("canned_message", { ascending: true });

      if (messagesError) throw messagesError;

      // Filter messages based on user's departments
      let filteredMessages = messages || [];
      
      if (userId && userDepartments.length > 0) {
        // Include messages that are either:
        // 1. Not department-specific (dept_id is null)
        // 2. Belong to one of the user's departments
        filteredMessages = filteredMessages.filter(msg => 
          msg.dept_id === null || userDepartments.includes(msg.dept_id)
        );
      } else if (userId) {
        // User has no departments - only show non-department-specific messages
        filteredMessages = filteredMessages.filter(msg => msg.dept_id === null);
      }

      // Format the response to match expected structure
      const formattedMessages = filteredMessages.map(msg => msg.canned_message);

      // Cache the result
      await cacheService.setCannedMessages(roleId, formattedMessages, userId);
      console.log(`✅ Cached ${formattedMessages.length} canned messages for role ${roleId}`);

      return formattedMessages;
    } catch (error) {
      console.error("❌ Error fetching canned messages:", error.message);
      throw error;
    }
  }

  /**
   * Get user's role ID with caching
   */
  async getUserRole(userId) {
    try {
      // Try to get from user profile cache first
      const profile = await cacheService.getUserProfile(userId, "agent");
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
      console.error("❌ Error fetching user role:", error.message);
      throw error;
    }
  }

  /**
   * Get all active chat groups for a user (only active chats)
   */
  async getChatGroupsByUser(userId) {
    try {
      // Try to get from cache first
      const cachedGroups = await cacheService.getUserChatGroups(userId);
      
      if (cachedGroups) {
        return cachedGroups;
      }

      console.log('chat groups fetching from db...')

      // Cache miss - fetch from database
      const { data, error } = await supabase
        .from("chat_group")
        .select(
          `
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
          `,
        )
        .eq("status", "active")
        .eq("sys_user_id", userId);

      if (error) throw error;

      const groups = data || [];

      // Cache for 5 minutes (chat groups change frequently)
      await cacheService.cacheUserChatGroups(userId, groups);

      return groups;
    } catch (error) {
      console.error("❌ Error fetching chat groups:", error.message);
      throw error;
    }
  }

  /**
   * Get resolved chat groups for a user
   */
  async getResolvedChatGroupsByUser(userId) {
    try {
      // Try to get from cache first
      const cachedGroups = await cacheService.getResolvedUserChatGroups(userId);

      if (cachedGroups) {
        return cachedGroups;
      }

      // Cache miss - fetch from database
      const { data, error } = await supabase
        .from("chat_group")
        .select(
          `
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
          `,
        )
        .eq("status", "resolved")
        .eq("sys_user_id", userId);

      if (error) throw error;

      const groups = data || [];

      // Cache for 5 minutes
      await cacheService.cacheResolvedUserChatGroups(userId, groups);

      return groups;
    } catch (error) {
      console.error("❌ Error fetching resolved chat groups:", error.message);
      throw error;
    }
  }

  /**
   * Get chat messages with pagination and sender information - Optimized with caching
   */
  async getChatMessages(
    messageId,
    before = null,
    limit = 30,
    currentUserId = null,
  ) {
    try {
      // Enforce limit bounds for performance
      const MAX_LIMIT = 100;
      const safeLimit = Math.min(parseInt(limit, 10), MAX_LIMIT);

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
          return { messages: [], totalCount: 0 };
        }

        chatGroupId = activeGroup.chat_group_id;
      }

      // Try to get recent messages from cache first
      let cachedMessages = [];
      if (!before && safeLimit <= 50) {
        cachedMessages = await cacheService.getChatMessages(chatGroupId);

        if (cachedMessages.length > 0) {
          // Sort and limit cached messages
          cachedMessages.sort(
            (a, b) => new Date(b.chat_created_at) - new Date(a.chat_created_at),
          );
          const limitedMessages = cachedMessages.slice(0, safeLimit);

          // Process cached messages
          const processedMessages = limitedMessages
            .map((msg) => ({
              ...msg,
              sender_type: determineSenderType(msg, currentUserId),
              sender_name: getSenderName(msg),
              sender_image: getSenderImageOptimized(msg),
            }))
            .reverse();

          return {
            messages: processedMessages,
            totalCount: processedMessages.length,
          };
        }
      }

      // Cache miss or pagination - fetch from database
      let query = supabase
        .from("chat")
        .select(
          `
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
        `,
        )
        .eq("chat_group_id", chatGroupId) // Only messages from this specific chat group
        .order("chat_created_at", { ascending: false })
        .limit(safeLimit);

      if (before) {
        query = query.lt("chat_created_at", before);
      }

      console.log(`fetching ${safeLimit} messages`);

      const { data: rows, error: chatErr } = await query;
      if (chatErr) throw chatErr;

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

      // Merge messages and transfers, then sort by timestamp
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

      // Limit results
      filteredMessages = filteredMessages.slice(-safeLimit);

      // Process messages (skip transfer messages as they're already formatted)
      const messages = filteredMessages.map((msg) => {
        if (msg.message_type === "transfer") {
          return msg;
        }
        return {
          ...msg,
          sender_type: determineSenderType(msg, currentUserId),
          sender_name: getSenderName(msg),
          sender_image: getSenderImageOptimized(msg),
        };
      });

      // Cache recent messages if this was a fresh fetch
      if (!before && messages.length > 0) {
        await cacheService.cacheChatMessages(chatGroupId, messages);
      }

      return {
        messages,
        totalCount: messages.length,
      };
    } catch (error) {
      console.error("❌ Error fetching chat messages:", error.message);
      throw error;
    }
  }

  /**
   * Insert a new chat message
   */
  async insertMessage(messageData) {
    try {
      // Verify chat group exists and is not resolved
      if (messageData.chat_group_id) {
        const { data: chatGroup, error: groupError } = await supabase
          .from("chat_group")
          .select("chat_group_id, status")
          .eq("chat_group_id", messageData.chat_group_id)
          .single();

        if (groupError) {
          throw new Error("Chat group not found");
        }

        if (chatGroup.status === "resolved") {
          throw new Error("Cannot send messages to a resolved chat");
        }
      }

      const { data, error: insertError } = await supabase
        .from("chat")
        .insert([messageData])
        .select("*");

      if (insertError) throw insertError;

      const newMessage = data && data.length > 0 ? data[0] : null;

      // Invalidate chat message cache for this group
      if (newMessage && newMessage.chat_group_id) {
        await cacheService.invalidateChatMessages(newMessage.chat_group_id);
      }

      return newMessage;
    } catch (error) {
      console.error("❌ Error inserting message:", error.message);
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
        throw new Error(
          "Chat group not found or you don't have permission to transfer it",
        );
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
          transferred_at: new Date().toISOString(),
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
          sys_user_id: null,
        })
        .eq("chat_group_id", chatGroupId);

      if (updateError) throw updateError;

      // Use round-robin to auto-assign to an available agent in the new department
      const assignmentResult = await agentAssignmentService.autoAssignChatGroup(
        chatGroupId,
        deptId,
      );

      console.log(
        `✅ Chat ${chatGroupId} transferred from dept ${fromDeptId} to ${deptId}:`,
        assignmentResult.assigned
          ? `assigned to agent ${assignmentResult.agentId}`
          : "queued (no available agents)",
      );

      // If agent was found, UPDATE the transfer log with to_agent_id
      if (
        assignmentResult.assigned &&
        assignmentResult.agentId &&
        transferLog
      ) {
        const { error: updateLogError } = await supabase
          .from("chat_transfer_log")
          .update({
            to_agent_id: assignmentResult.agentId,
          })
          .eq("transfer_id", transferLog.transfer_id);

        if (updateLogError) {
          console.error(
            "⚠️ Failed to update transfer log with to_agent_id:",
            updateLogError.message,
          );
        } else {
          console.log(
            `✅ Updated transfer log ${transferLog.transfer_id} with to_agent_id: ${assignmentResult.agentId}`,
          );
        }
      }

      // Fetch the updated chat group
      const { data: updatedChat, error: finalError } = await supabase
        .from("chat_group")
        .select("chat_group_id, dept_id, sys_user_id, status")
        .eq("chat_group_id", chatGroupId)
        .single();

      if (finalError) throw finalError;

      await cacheService.invalidateChatMessages(chatGroupId);

      // Invalidate both old and new agent's chat groups cache
      await cacheService.invalidateUserChatGroups(userId);

      if (assignmentResult.assigned && assignmentResult.agentId) {
        await cacheService.invalidateUserChatGroups(assignmentResult.agentId);
      }

      return {
        ...updatedChat,
        from_dept_id: fromDeptId,
        assignmentResult,
      };
    } catch (error) {
      console.error("❌ Error transferring chat group:", error.message);
      throw error;
    }
  }

  /**
   * Transfer chat group directly to a specific agent
   */
  async transferChatGroupToAgent(chatGroupId, agentId, userId) {
    try {
      // Verify the chat group exists and the caller is the assigned agent
      const { data: chatGroup, error: fetchError } = await supabase
        .from("chat_group")
        .select("chat_group_id, dept_id, sys_user_id")
        .eq("chat_group_id", chatGroupId)
        .eq("sys_user_id", userId)
        .single();

      if (fetchError || !chatGroup) {
        throw new Error(
          "Chat group not found or you don't have permission to transfer it",
        );
      }

      const fromDeptId = chatGroup.dept_id;
      const fromAgentId = chatGroup.sys_user_id;
      console.log('agentId: ', agentId)
      // Fetch target agent's department from sys_user_department junction table
      const { data: targetAgentDept, error: agentError } = await supabase
        .from("sys_user_department")
        .select("dept_id")
        .eq("sys_user_id", agentId)
        .limit(1)
        .single();
      
      if (agentError || !targetAgentDept) {
        throw new Error("Target agent not found or has no department assigned");
      }

      const toDeptId = targetAgentDept.dept_id;

      // Log the transfer
      const { error: logError } = await supabase
        .from("chat_transfer_log")
        .insert({
          chat_group_id: chatGroupId,
          from_agent_id: fromAgentId,
          to_agent_id: agentId,
          from_dept_id: fromDeptId,
          to_dept_id: toDeptId,
          transfer_type: "manual",
          transferred_at: new Date().toISOString(),
        });

      if (logError) {
        console.error("⚠️ Failed to log agent transfer:", logError.message);
      }

      // Directly assign to the target agent
      const { error: updateError } = await supabase
        .from("chat_group")
        .update({
          sys_user_id: agentId,
          dept_id: toDeptId,
          status: "active",
        })
        .eq("chat_group_id", chatGroupId);

      if (updateError) throw updateError;

      console.log(
        `✅ Chat ${chatGroupId} transferred directly from agent ${fromAgentId} to agent ${agentId}`,
      );

      // Fetch the updated chat group
      const { data: updatedChat, error: finalError } = await supabase
        .from("chat_group")
        .select("chat_group_id, dept_id, sys_user_id, status")
        .eq("chat_group_id", chatGroupId)
        .single();

      if (finalError) throw finalError;

      await cacheService.invalidateChatMessages(chatGroupId);
      await cacheService.invalidateUserChatGroups(userId);
      await cacheService.invalidateUserChatGroups(agentId);

      return {
        ...updatedChat,
        from_dept_id: fromDeptId,
        to_agent_id: agentId,
      };
    } catch (error) {
      console.error("❌ Error transferring chat group to agent:", error.message);
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
          resolved_at: new Date().toISOString(),
        })
        .eq("chat_group_id", chatGroupId)
        .eq("sys_user_id", userId) // Ensure only the assigned user can resolve
        .select()
        .single();

      if (chatError) throw chatError;

      if (!chatGroup) {
        throw new Error(
          "Chat group not found or you don't have permission to resolve it",
        );
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
            message_count: feedbackData.messageCount || null,
          })
          .select()
          .single();

        if (feedbackError) {
          console.warn("⚠️ Failed to save feedback:", feedbackError.message);
        } else {
          feedbackRecord = feedback;

          // Update chat group with feedback reference
          await supabase
            .from("chat_group")
            .update({ feedback_id: feedback.feedback_id })
            .eq("chat_group_id", chatGroupId);
        }
      }

      await cacheService.invalidateChatMessages(chatGroupId);

      // Invalidate user's active and resolved chat groups cache
      await cacheService.invalidateUserChatGroups(userId);
      await cacheService.invalidateResolvedUserChatGroups(userId);

      return {
        ...chatGroup,
        feedback: feedbackRecord,
      };
    } catch (error) {
      console.error("❌ Error resolving chat group:", error.message);
      throw error;
    }
  }

  /**
   * Get transfer details (department names and agent name) for socket emission.
   * Moves DB lookups out of the controller.
   */
  async getTransferDetails(fromDeptId, toDeptId, assignmentResult) {
    const [fromDeptResult, toDeptResult] = await Promise.all([
      supabase
        .from("department")
        .select("dept_name")
        .eq("dept_id", fromDeptId || 0)
        .single(),
      supabase
        .from("department")
        .select("dept_name")
        .eq("dept_id", toDeptId)
        .single(),
    ]);

    let toAgentName = null;
    if (assignmentResult.assigned && assignmentResult.agentId) {
      const { data: agentData } = await supabase
        .from("sys_user")
        .select("prof_id, profile:profile(prof_firstname, prof_lastname)")
        .eq("sys_user_id", assignmentResult.agentId)
        .single();

      if (agentData?.profile) {
        toAgentName =
          `${agentData.profile.prof_firstname} ${agentData.profile.prof_lastname}`.trim();
      }
    }

    return {
      fromDeptName: fromDeptResult.data?.dept_name || "Unknown",
      toDeptName: toDeptResult.data?.dept_name || "Unknown",
      toAgentName,
    };
  }

  /**
   * Clear user-related caches (for cache invalidation)
   */
  async clearUserCache(userId) {
    try {
      await cacheService.invalidateUserProfile(userId, "agent");
      await cacheService.invalidateUserChatGroups(userId);
      await cacheService.invalidateResolvedUserChatGroups(userId);

      console.log(`🧹 Cleared cache for user ${userId}`);
    } catch (error) {
      console.error("❌ Error clearing user cache:", error.message);
    }
  }
}

module.exports = new ChatService();
