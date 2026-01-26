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
   * Get messages by chat group ID
   */
  async getMessagesByGroupId(chatGroupId) {
    const { data, error } = await supabase
      .from("chat")
      .select("*")
      .eq("chat_group_id", chatGroupId)
      .order("chat_created_at", { ascending: true });

    if (error) throw error;
    return data;
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
