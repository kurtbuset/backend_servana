// routes/chat.js
const express = require("express");
const router = express.Router();
const supabase = require("../helpers/supabaseClient");
const cookie = require("cookie");
const getCurrentUser = require("../middleware/getCurrentUser"); // attaches req.userId

router.use(getCurrentUser);

// Debug endpoint to check all chat_groups
router.get("/debug/all-chats", async (req, res) => {
  try {
    const { data: allGroups, error } = await supabase
      .from("chat_group")
      .select("*");
    
    console.log('All chat groups:', allGroups);
    console.log('Error:', error);
    
    res.json({
      total: allGroups?.length || 0,
      pending: allGroups?.filter(g => g.sys_user_id === null).length || 0,
      assigned: allGroups?.filter(g => g.sys_user_id !== null).length || 0,
      groups: allGroups
    });
  } catch (err) {
    console.error('Debug error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create test chat group for debugging
router.post("/debug/create-test-chat", async (req, res) => {
  try {
    // Get first available client
    const { data: clients, error: clientError } = await supabase
      .from("client")
      .select("client_id, prof_id")
      .limit(1);
    
    if (clientError || !clients || clients.length === 0) {
      return res.status(400).json({ 
        error: "No clients found. Please create a client first.",
        hint: "You need at least one client in the database"
      });
    }

    // Get first available department
    const { data: departments, error: deptError } = await supabase
      .from("department")
      .select("dept_id")
      .eq("dept_is_active", true)
      .limit(1);
    
    if (deptError || !departments || departments.length === 0) {
      return res.status(400).json({ 
        error: "No departments found. Please create a department first.",
        hint: "You need at least one active department"
      });
    }

    const clientId = clients[0].client_id;
    const deptId = departments[0].dept_id;

    // Create chat_group
    const { data: chatGroup, error: groupError } = await supabase
      .from("chat_group")
      .insert({
        client_id: clientId,
        dept_id: deptId,
        sys_user_id: null,
        chat_group_name: `Test Chat ${Date.now()}`
      })
      .select()
      .single();

    if (groupError) {
      return res.status(500).json({ error: groupError.message });
    }

    // Create initial message
    const { data: message, error: msgError } = await supabase
      .from("chat")
      .insert({
        chat_group_id: chatGroup.chat_group_id,
        client_id: clientId,
        sys_user_id: null,
        chat_body: "Hello! I need help with my account.",
        chat_created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (msgError) {
      console.error("Message creation error:", msgError);
    }

    res.json({
      success: true,
      message: "Test chat created successfully!",
      chatGroup: chatGroup,
      initialMessage: message
    });
  } catch (err) {
    console.error('Create test chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/chatgroups", async (req, res) => {
  // console.log('chatgroup reached')
  try {
    // First, try a simple query to see if we can get any data
    const { data: simpleGroups, error: simpleError } = await supabase
      .from("chat_group")
      .select("*")
      .is("sys_user_id", null);
    
    console.log('Simple query result:', simpleGroups);
    console.log('Simple query error:', simpleError);

    // Now try the full query with joins
    const { data: groups, error } = await supabase
      .from("chat_group")
      .select(`
        chat_group_id,
        dept_id,
        sys_user_id,
        client_id,
        department:dept_id(dept_name),
        client:client_id(
          client_id,
          client_number,
          prof_id,
          profile:prof_id(
            prof_firstname,
            prof_lastname
          )
        )
      `)
      .is("sys_user_id", null);

    console.log('Full query error:', error);
    console.log('Groups found:', groups);

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        error: error.message,
        details: error.details,
        hint: error.hint
      });
    }

    if (!groups || groups.length === 0) {
      console.log('No pending chat groups found');
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
      if (!client) {
        console.log('Group missing client:', group);
        return null;
      }

      const fullName = client.profile
        ? `${client.profile.prof_firstname || ''} ${client.profile.prof_lastname || ''}`.trim()
        : "Unknown Client";

      return {
        chat_group_id: group.chat_group_id,
        chat_group_name: fullName,
        department: group.department?.dept_name || "Unknown",
        customer: {
          id: client.client_id,
          chat_group_id: group.chat_group_id,
          name: fullName,
          number: client.client_number || "No number",
          profile: imageMap[client.prof_id] || null,
          time: "9:00 AM",
          sys_user_id: group.sys_user_id, // Include this for frontend
          isAccepted: false // Mark as not accepted
        },
      };
    });
    
    console.log('Formatted groups:', formatted);
    const result = formatted.filter(Boolean);
    console.log('Returning', result.length, 'chat groups');

    res.json(result);
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



// POST /queues/:chatGroupId/accept - Agent accepts a chat from queue
router.post("/:chatGroupId/accept", async (req, res) => {
  try {
    const { chatGroupId } = req.params;
    const agentId = req.userId; // from getCurrentUser middleware

    // Check if chat_group exists and is not already assigned
    const { data: chatGroup, error: checkError } = await supabase
      .from("chat_group")
      .select("chat_group_id, sys_user_id, client_id")
      .eq("chat_group_id", chatGroupId)
      .single();

    if (checkError || !chatGroup) {
      return res.status(404).json({ error: "Chat group not found" });
    }

    if (chatGroup.sys_user_id) {
      return res.status(400).json({ error: "Chat already assigned to another agent" });
    }

    // Assign agent to chat_group
    const { error: updateError } = await supabase
      .from("chat_group")
      .update({ sys_user_id: agentId })
      .eq("chat_group_id", chatGroupId);

    if (updateError) throw updateError;

    // Add to junction table
    const { error: junctionError } = await supabase
      .from("sys_user_chat_group")
      .insert({
        sys_user_id: agentId,
        chat_group_id: chatGroupId
      });

    if (junctionError) throw junctionError;

    // Broadcast count updates via socket
    // Note: You'll need to import io from index.js or pass it differently
    // For now, we'll emit from the client side after receiving success

    res.json({
      success: true,
      message: "Chat accepted successfully",
      agentId: agentId,
      chatGroupId: chatGroupId
    });
  } catch (err) {
    console.error("❌ Error accepting chat:", err);
    res.status(500).json({ error: "Failed to accept chat" });
  }
});


module.exports = router;
