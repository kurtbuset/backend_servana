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
   */
  async getLatestChatGroup(clientId) {
    const { data: group, error } = await supabase
      .from("chat_group")
      .select("chat_group_id")
      .eq("client_id", clientId)
      .order("chat_group_id", { ascending: false })
      .limit(1)
      .single();

    if (error || !group) {
      throw new Error("Could not retrieve chat group");
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
}

module.exports = new MobileMessageService();
