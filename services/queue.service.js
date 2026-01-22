const supabase = require("../helpers/supabaseClient");

class QueueService {
  /**
   * Get unassigned chat groups (queue)
   */
  async getUnassignedChatGroups(userId) {
    // First, get all department IDs assigned to this user
    const { data: userDepartments, error: deptError } = await supabase
      .from("sys_user_department")
      .select("dept_id")
      .eq("sys_user_id", userId);

    if (deptError) throw deptError;

    // If user has no assigned departments, return empty array
    if (!userDepartments || userDepartments.length === 0) {
      return [];
    }

    // Extract dept_ids into an array
    const deptIds = userDepartments.map(d => d.dept_id);

    // Get chat groups that match user's departments
    const { data: groups, error } = await supabase
      .from("chat_group")
      .select(`
      chat_group_id,
      dept_id,
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
      .in("dept_id", deptIds) // Only get chat groups with matching department

    if (error) throw error;
    return groups || [];
  }

  /**
   * Get profile images for multiple profile IDs
   */
  async getProfileImages(profIds) {
    if (!profIds || profIds.length === 0) return {};

    const imageMap = {};

    // Get current images
    const { data: images, error: imgErr } = await supabase
      .from("image")
      .select("prof_id, img_location")
      .in("prof_id", profIds)
      .eq("img_is_current", true);

    if (imgErr) throw imgErr;

    const foundIds = (images || []).map((i) => i.prof_id);
    const missingIds = profIds.filter((id) => !foundIds.includes(id));

    // Get latest images for missing profiles
    if (missingIds.length > 0) {
      const { data: latest, error: latestErr } = await supabase
        .from("image")
        .select("prof_id, img_location")
        .in("prof_id", missingIds)
        .order("img_created_at", { ascending: false });

      if (!latestErr && latest) {
        latest.forEach((i) => (imageMap[i.prof_id] = i.img_location));
      }
    }

    // Map current images
    (images || []).forEach((i) => (imageMap[i.prof_id] = i.img_location));

    return imageMap;
  }

  /**
   * Get latest message timestamp for chat groups
   */
  async getLatestMessageTimes(chatGroupIds) {
    if (!chatGroupIds || chatGroupIds.length === 0) return {};

    const { data: messages, error } = await supabase
      .from("chat")
      .select("chat_group_id, chat_created_at")
      .in("chat_group_id", chatGroupIds)
      .not("client_id", "is", null) // Only get messages from clients
      .order("chat_created_at", { ascending: false });

    if (error) throw error;

    // Create a map of chat_group_id to latest message time
    const timeMap = {};
    (messages || []).forEach((msg) => {
      if (!timeMap[msg.chat_group_id]) {
        timeMap[msg.chat_group_id] = msg.chat_created_at;
      }
    });

    return timeMap;
  }

  /**
   * Get chat groups for a client
   */
  async getChatGroupsByClient(clientId) {
    const { data: groups, error } = await supabase
      .from("chat_group")
      .select("chat_group_id")
      .eq("client_id", clientId);

    if (error) throw error;
    return groups || [];
  }

  /**
   * Assign chat group to user
   */
  async assignChatGroupToUser(chatGroupId, userId) {
    const { error } = await supabase
      .from("chat_group")
      .update({ sys_user_id: userId })
      .eq("chat_group_id", chatGroupId)
      .is("sys_user_id", null); // avoid overwriting if already set

    if (error) throw error;
  }

  /**
   * Check if user-chat group link exists
   */
  async checkUserChatGroupLink(userId, chatGroupId) {
    const { data, error } = await supabase
      .from("sys_user_chat_group")
      .select("id")
      .eq("sys_user_id", userId)
      .eq("chat_group_id", chatGroupId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Create user-chat group link
   */
  async createUserChatGroupLink(userId, chatGroupId) {
    const { error } = await supabase
      .from("sys_user_chat_group")
      .insert([{ sys_user_id: userId, chat_group_id: chatGroupId }]);

    if (error) throw error;
  }

  /**
   * Get chat messages with pagination
   */
  async getChatMessages(clientId, groupIdsToFetch, before = null, limit = 10) {
    let query = supabase
      .from("chat")
      .select("*")
      .or(
        [
          `client_id.eq.${clientId}`,
          groupIdsToFetch.length > 0
            ? `chat_group_id.in.(${groupIdsToFetch.join(",")})`
            : "chat_group_id.eq.0",
        ].join(",")
      )
      .order("chat_created_at", { ascending: false })
      .limit(parseInt(limit, 10));

    if (before) {
      query = query.lt("chat_created_at", before);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    // Deduplicate messages
    const seen = new Set();
    const messages = (rows || [])
      .filter((r) => {
        if (seen.has(r.chat_id)) return false;
        seen.add(r.chat_id);
        return true;
      })
      .reverse();

    return messages;
  }
}

module.exports = new QueueService();
