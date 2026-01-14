// routes/chat.js
const express = require("express");
const router = express.Router();
const supabase = require("../helpers/supabaseClient");
const cookie = require("cookie");
const getCurrentUser = require("../middleware/getCurrentUser"); // attaches req.userId

router.use(getCurrentUser);

router.get("/chatgroups", async (req, res) => {
  console.log('chatgroup reached')
  try {
    const { data: groups, error } = await supabase
      .from("chat_group")
      .select(
        `
    chat_group_id,
    dept_id,
    sys_user_id,
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
  `
      )
      .is("sys_user_id", null) // Only get chat_groups with no agent assigned

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
    console.log(groups)
    console.log(formatted)

    res.json(formatted.filter(Boolean));
  } catch (err) {
    console.error("❌ Error fetching chat groups:", err);
    res.status(500).json({ error: "Failed to fetch chat groups" });
  }
});


router.get("/:clientId", async (req, res) => {
  const { clientId } = req.params;
  const { before, limit = 10 } = req.query;
  const userId = req.userId;

  // Step 1: Fetch all chat groups for this client
  const { data: groups, error: groupsErr } = await supabase
    .from("chat_group")
    .select("chat_group_id, sys_user_id")
    .eq("client_id", clientId);

  if (groupsErr) {
    return res.status(500).json({ error: groupsErr.message });
  }

  if (!groups || groups.length === 0) {
    return res.status(404).json({ error: "Chat group not found" });
  }

  const groupIdsToFetch = [];

  for (const group of groups) {
    const { chat_group_id, sys_user_id } = group;

    if (sys_user_id === null) {
      // ✅ Update chat_group.sys_user_id to current user
      const { error: updateErr } = await supabase
        .from("chat_group")
        .update({ sys_user_id: userId })
        .eq("chat_group_id", chat_group_id)
        .is("sys_user_id", null); // avoid overwriting if already set

      if (updateErr) {
        console.error("Failed to update chat_group:", updateErr.message);
      }

      // ✅ Check if sys_user_chat_group already exists
      const { data: existingLink, error: checkErr } = await supabase
        .from("sys_user_chat_group")
        .select("id")
        .eq("sys_user_id", userId)
        .eq("chat_group_id", chat_group_id)
        .maybeSingle();

      if (checkErr) {
        console.error("Failed to check sys_user_chat_group:", checkErr.message);
      }

      // ✅ Insert new sys_user_chat_group link if not exists
      if (!existingLink) {
        const { error: insertErr } = await supabase
          .from("sys_user_chat_group")
          .insert([{ sys_user_id: userId, chat_group_id }]);

        if (insertErr) {
          console.error("Failed to insert into sys_user_chat_group:", insertErr.message);
        }
      }

      groupIdsToFetch.push(chat_group_id); // this group is now owned by user
    } else {
      // 🚫 Do not update sys_user_id if already set
      // ✅ Still add to groupIdsToFetch if user already linked (optional)
      const { data: existingLink, error: checkErr } = await supabase
        .from("sys_user_chat_group")
        .select("id")
        .eq("sys_user_id", userId)
        .eq("chat_group_id", chat_group_id)
        .maybeSingle();

      if (!checkErr && existingLink) {
        groupIdsToFetch.push(chat_group_id);
      }
    }
  }

  // Step 2: Fetch chats
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

  const { data: rows, error: chatErr } = await query;
  if (chatErr) {
    return res.status(500).json({ error: chatErr.message });
  }

  const seen = new Set();
  const messages = (rows || [])
    .filter((r) => {
      if (seen.has(r.chat_id)) return false;
      seen.add(r.chat_id);
      return true;
    })
    .reverse();

  res.json({ messages });
});



module.exports = router;
