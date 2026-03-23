const supabase = require("../../helpers/supabaseClient");
const agentAssignmentService = require("../agentAssignment.service");

class MobileMessageService {
  /**
   * Create a new message
   */
  async createMessage(chatBody, clientId, chatGroupId) {
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
    return data;
  }

  /**
   * Get messages by chat group ID with pagination
   * @param {number} chatGroupId - The chat group ID
   * @param {string} before - ISO timestamp for pagination (optional)
   * @param {number} limit - Number of messages to fetch (default: 10)
   * @returns {Promise<Object>} Object containing messages array and pagination info
   */
  async getMessagesByGroupId(chatGroupId, before = null, limit = 10) {
    let query = supabase
      .from("chat")
      .select(`
        chat_id,
        chat_body,
        chat_created_at,
        chat_delivered_at,
        chat_read_at,
        sys_user_id,
        client_id,
        chat_group_id
      `)
      .eq("chat_group_id", chatGroupId)
      .order("chat_created_at", { ascending: false }) // Get newest first for pagination
      .limit(limit);

    // Add pagination filter if 'before' timestamp is provided
    if (before) {
      query = query.lt("chat_created_at", before);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Reverse the array to show oldest messages first in UI
    const messages = data.reverse();

    return {
      messages,
      hasMore: data.length === limit, // If we got the full limit, there might be more
      count: messages.length,
      oldestTimestamp: messages.length > 0 ? messages[0].chat_created_at : null,
      newestTimestamp: messages.length > 0 ? messages[messages.length - 1].chat_created_at : null
    };
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
          status: "queued", // Initially queued
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
        department
      );

      console.log(`📋 Chat group ${chatGroupId} assignment result:`, assignmentResult);

      return {
        chat_group_id: chatGroupId,
        assigned: assignmentResult.assigned,
        status: assignmentResult.status,
        agent_id: assignmentResult.agentId || null,
        department
      };
    } catch (assignError) {
      console.error("❌ Error auto-assigning chat group:", assignError.message);
      // Return chat group ID even if assignment fails
      return {
        chat_group_id: chatGroupId,
        assigned: false,
        status: "queued",
        agent_id: null,
        department
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
        .select("chat_group_id, client_id, status")
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
          resolved_at: new Date().toISOString()
        })
        .eq("chat_group_id", chatGroupId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Store feedback if provided
      let feedbackRecord = null;
      if (feedbackData.rating || feedbackData.feedback) {
        console.log('💾 Storing feedback:', {
          rating: feedbackData.rating,
          feedback: feedbackData.feedback ? 'provided' : 'none',
          duration: feedbackData.chatDurationSeconds,
          messageCount: feedbackData.messageCount
        });

        const { data: feedback, error: feedbackError } = await supabase
          .from("chat_feedback")
          .insert({
            chat_group_id: chatGroupId,
            client_id: clientId,
            rating: feedbackData.rating || null,
            feedback_text: feedbackData.feedback || null,
            chat_duration_seconds: feedbackData.chatDurationSeconds || null,
            message_count: feedbackData.messageCount || null
          })
          .select()
          .single();

        if (feedbackError) {
          console.warn('⚠️ Failed to save feedback:', feedbackError.message);
          console.warn('⚠️ Feedback data that failed:', {
            chat_group_id: chatGroupId,
            client_id: clientId,
            rating: feedbackData.rating,
            feedback_text: feedbackData.feedback,
            chat_duration_seconds: feedbackData.chatDurationSeconds,
            message_count: feedbackData.messageCount
          });
        } else {
          feedbackRecord = feedback;
          console.log('✅ Feedback saved successfully:', feedback);
          
          // Update chat group with feedback reference
          const { error: updateError } = await supabase
            .from("chat_group")
            .update({ feedback_id: feedback.feedback_id })
            .eq("chat_group_id", chatGroupId);

          if (updateError) {
            console.warn('⚠️ Failed to link feedback to chat group:', updateError.message);
          }
        }
      } else {
        console.log('ℹ️ No feedback provided by client');
      }

      return {
        chat_group_id: updatedGroup.chat_group_id,
        status: updatedGroup.status,
        resolved_at: updatedGroup.resolved_at,
        feedback: feedbackRecord
      };
    } catch (error) {
      console.error('❌ Error ending chat group:', error.message);
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
        .select(`
          chat_group_id,
          resolved_at,
          created_at,
          department:department(dept_name),
          chat_feedback:feedback_id(
            rating,
            feedback_text,
            chat_duration_seconds,
            message_count
          )
        `)
        .eq("client_id", clientId)
        .eq("status", "resolved")
        .order("resolved_at", { ascending: false });

      if (error) throw error;

      // Format the response
      const formattedChats = resolvedChats.map(chat => ({
        chat_group_id: chat.chat_group_id,
        department: chat.department?.dept_name || 'Unknown Department',
        resolved_at: chat.resolved_at,
        created_at: chat.created_at,
        rating: chat.chat_feedback?.rating || null,
        feedback: chat.chat_feedback?.feedback_text || null,
        duration_seconds: chat.chat_feedback?.chat_duration_seconds || null,
        message_count: chat.chat_feedback?.message_count || 0,
      }));

      return formattedChats;
    } catch (error) {
      console.error('❌ Error fetching resolved chats:', error.message);
      throw error;
    }
  }
}

module.exports = new MobileMessageService();
