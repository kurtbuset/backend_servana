const supabase = require("../helpers/supabaseClient");
const cookie = require("cookie");

class ChatService {
  /**
   * Get canned messages for a specific role
   */
  async getCannedMessagesByRole(roleId) {
    const { data: messages, error } = await supabase
      .from("canned_message")
      .select("canned_id, canned_message")
      .eq("role_id", roleId)
      .eq("canned_is_active", true);

    if (error) throw error;
    return messages;
  }

  /**
   * Get user's role ID
   */
  async getUserRole(userId) {
    const { data: userData, error: userError } = await supabase
      .from("sys_user")
      .select("role_id")
      .eq("sys_user_id", userId)
      .single();

    if (userError || !userData) {
      throw new Error("User not found or no role.");
    }

    return userData.role_id;
  }

  /**
   * Get all chat groups for a user
   */
  async getChatGroupsByUser(userId) {
    const { data: groups, error } = await supabase
      .from("chat_group")
      .select(`
        chat_group_id,
        dept_id,
        sys_user_chat_group!inner(sys_user_id),
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
      .eq("sys_user_chat_group.sys_user_id", userId);

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
   * Get chat messages with pagination
   */
  async getChatMessages(clientId, before = null, limit = 10) {
    const groups = await this.getChatGroupsByClient(clientId);
    
    if (groups.length === 0) {
      throw new Error("Chat group not found");
    }

    const groupIds = groups.map((g) => g.chat_group_id);

    let query = supabase
      .from("chat")
      .select("*")
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
    const { data, error: insertError } = await supabase
      .from("chat")
      .insert([messageData])
      .select("*");

    if (insertError) throw insertError;
    return data && data.length > 0 ? data[0] : null;
  }
}

module.exports = new ChatService();
