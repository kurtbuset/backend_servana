// backend/routes/messages.js
const express = require('express');
const router = express.Router();
const supabase = require('../../helpers/supabaseClient');
const getCurrentMobileUser = require("../../middleware/getCurrentMobileUser.js") //this routes require an authenticated user; attaches req.userId

router.use(getCurrentMobileUser);

router.post("/", async (req, res) => {
  const { chat_body, chat_group_id } = req.body;
  const client_id = req.userId; // from getCurrentUser middleware

  if (!chat_body || !chat_group_id || !client_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { data, error } = await supabase
      .from("chat")
      .insert([
        {
          chat_body,
          client_id,
          chat_group_id,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    console.error("Failed to insert chat:", err.message);
    res.status(500).json({ error: "Failed to insert chat" });
  }
});

router.get("/group/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("chat")
      .select("*")
      .eq("chat_group_id", id)
      .order("chat_created_at", { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// GET /chat-group/latest
// GET /messages/latest - returns latest chat group for current client
router.get('/latest', async (req, res) => {
  const clientId = req.userId;

  const { data: group, error } = await supabase
    .from("chat_group")
    .select("chat_group_id")
    .eq("client_id", clientId)
    .order("chat_group_id", { ascending: false })
    .limit(1)
    .single();

  if (error || !group) {
    console.error("❌ Could not retrieve latest chat group:", error?.message);
    return res.status(404).json({ error: "Could not retrieve chat group" });
  }

  return res.status(200).json({ chat_group_id: group.chat_group_id });
});

// POST /messages/group/create
router.post("/group/create", getCurrentMobileUser, async (req, res) => {
  const { department } = req.body;
  const clientId = req.userId;

  if (!department || !clientId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { data, error } = await supabase
      .from("chat_group")
      .insert([
        {
          dept_id: department,
          client_id: clientId,
          chat_group_name: `Chat with Dept ${department}`

        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ chat_group_id: data.chat_group_id });
  } catch (err) {
    console.error("Error creating chat group:", err.message);
    res.status(500).json({ error: "Failed to create chat group" });
  }
});



module.exports = router;
