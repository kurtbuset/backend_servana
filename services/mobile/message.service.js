const supabase = require("../../helpers/supabaseClient");

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
      .select("*")
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
   * Create a new chat group
   */
  async createChatGroup(department, clientId) {
    const { data, error } = await supabase
      .from("chat_group")
      .insert([
        {
          dept_id: department,
          client_id: clientId,
          status: "queued",
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return data.chat_group_id;
  }
}

module.exports = new MobileMessageService();
