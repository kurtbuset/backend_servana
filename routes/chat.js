// routes/chat.js
const express = require("express");
const router = express.Router();
const supabase = require("../helpers/supabaseClient");
const cookie = require("cookie");
const getCurrentUser = require("../middleware/getCurrentUser"); // attaches req.userId


router.use(getCurrentUser);

router.get("/canned-messages", async (req, res) => {
  try {
    const { userId } = req; // from getCurrentUser middleware

    // Get user's role_id
    const { data: userData, error: userError } = await supabase
      .from("sys_user")
      .select("role_id")
      .eq("sys_user_id", userId)
      .single();

    if (userError || !userData) {
      return res.status(403).json({ error: "User not found or no role." });
    }

    

    // Fetch active canned messages for that role
    const { data: messages, error } = await supabase
      .from("canned_message")
      .select("canned_id, canned_message")
      .eq("role_id", userData.role_id)
      .eq("canned_is_active", true);

    if (error) throw error;

    res.json(messages);
  } catch (err) {
    console.error("❌ Error fetching canned messages:", err);
    res.status(500).json({ error: "Failed to fetch canned messages" });
  }
});


router.get("/chatgroups", async (req, res) => {
  try {
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
      .eq("sys_user_chat_group.sys_user_id", req.userId);

    if (error) throw error;

    

    if (!groups || groups.length === 0) {
      return res.json([]);
    }

    const profIds = groups
      .map((g) => g.client?.prof_id)
      .filter((id) => id !== undefined && id !== null);

    let imageMap = {};
    if (profIds.length) {
      const { data: images, error: imgErr } = await supabase
        .from("image")
        .select("prof_id, img_location")
        .in("prof_id", profIds)
        .eq("img_is_current", true);
      if (imgErr) throw imgErr;

      const foundIds = (images || []).map((i) => i.prof_id);
      const missingIds = profIds.filter((id) => !foundIds.includes(id));

      if (missingIds.length > 0) {
        const { data: latest, error: latestErr } = await supabase
          .from("image")
          .select("prof_id, img_location")
          .in("prof_id", missingIds)
          .order("img_created_at", { ascending: false });
        if (!latestErr && latest) {
          (latest || []).forEach((i) => (imageMap[i.prof_id] = i.img_location));
        }
      }

      (images || []).forEach((i) => (imageMap[i.prof_id] = i.img_location));
    }

    const formatted = groups.map((group) => {
      const client = group.client;
      if (!client) return null;

      const fullName = client.profile
        ? `${client.profile.prof_firstname} ${client.profile.prof_lastname}`
        : "Unknown Client";

      return {
        chat_group_id: group.chat_group_id,
        chat_group_name: fullName,
        department: group.department?.dept_name || "Unknown",
        customer: {
          id: client.client_id,
          chat_group_id: group.chat_group_id,
          name: fullName,
          number: client.client_number,
          profile: imageMap[client.prof_id] || null,
          time: "9:00 AM",
        },
      };
    });

  
    res.json(formatted.filter(Boolean));
  } catch (err) {
    console.error("❌ Error fetching chat groups:", err);
    res.status(500).json({ error: "Failed to fetch chat groups" });
  }
});





router.get("/:clientId", async (req, res) => {
  const { clientId } = req.params;
  console.log('clientId: ', clientId)
  const { before, limit = 10 } = req.query;

  // Find all groups that belong to this client (usually 1, but safe for >1)
  const { data: groups, error: groupsErr } = await supabase
    .from("chat_group")
    .select("chat_group_id")
    .eq("client_id", clientId);

  if (groupsErr) {
    return res.status(500).json({ error: groupsErr.message });
  }
  if (!groups || groups.length === 0) {
    return res.status(404).json({ error: "Chat group not found" });
  }

  const groupIds = groups.map(g => g.chat_group_id);

  // Fetch both sides of the conversation:
  // - client messages (client_id = clientId)
  // - agent messages (client_id is NULL but in this client's chat_group_id(s))
  let query = supabase
    .from("chat")
    .select("*")
    .or([
      `client_id.eq.${clientId}`,
      `chat_group_id.in.(${groupIds.join(",")})`
    ].join(","))
    .order("chat_created_at", { ascending: false })
    .limit(parseInt(limit, 10));

  if (before) {
    query = query.lt("chat_created_at", before);
  }

  const { data: rows, error: chatErr } = await query;
  if (chatErr) {
    return res.status(500).json({ error: chatErr.message });
  }

  // De-dup (in case a row matches both branches) and send oldest→newest
  const seen = new Set();
  const messages = (rows || []).filter(r => {
    if (seen.has(r.chat_id)) return false;
    seen.add(r.chat_id);
    return true;
  }).reverse();

  res.json({ messages });
});


// --- unchanged ---
async function handleSendMessage(rawMessage, io, socket) {
  try {
    const cookies = cookie.parse(socket.handshake.headers.cookie || "");
    const token = cookies.access_token;
    if (!token) {
      console.error("No access token found in parsed cookies.");
      return;
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.error("Invalid token:", error?.message);
      return;
    }

    // map supabase user to system_user
    const { data: userData, error: userFetchError } = await supabase
      .from("sys_user")
      .select("sys_user_id")
      .eq("supabase_user_id", user.id)
      .single();

    if (userFetchError || !userData) {
      console.error("Failed to fetch system_user:", userFetchError?.message);
      return;
    }

    const message = {
      ...rawMessage,
      sys_user_id: userData.sys_user_id, // BIGINT system_user id
    };

    console.log(message)

    // push list refresh first (keeps your existing UI behavior)
    io.emit("updateChatGroups");

    const { data, error: insertError } = await supabase
      .from("chat")
      .insert([message])
      .select("*");

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return;
    }

    if (data && data.length > 0) {
      io.to(String(message.chat_group_id)).emit("receiveMessage", data[0]);
    }
  } catch (err) {
    console.error("handleSendMessage error:", err.message);
  }
}




module.exports = { router, handleSendMessage };
