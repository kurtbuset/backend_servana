const supabase = require('../../helpers/supabaseClient');

/**
 * Helper functions for chat group operations
 */
class ChatGroupHelper {
  /**
   * Get chat group information including department
   * @param {number} chatGroupId - Chat group ID
   * @returns {Promise<Object|null>} Chat group info or null
   */
  async getChatGroupInfo(chatGroupId) {
    try {
      const { data: chatGroup, error } = await supabase
        .from('chat_group')
        .select(`
          chat_group_id,
          client_id,
          dept_id,
          sys_user_id,
          status,
          department:dept_id (
            dept_id,
            dept_name
          )
        `)
        .eq('chat_group_id', chatGroupId)
        .single();

      if (error || !chatGroup) {
        throw new Error('Chat group not found');
      }

      return chatGroup;
    } catch (error) {
      console.error('❌ Error getting chat group info:', error);
      return null;
    }
  }
}

module.exports = new ChatGroupHelper();
