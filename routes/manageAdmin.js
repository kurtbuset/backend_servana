const express = require("express");
const router = express.Router();
const supabase = require("../helpers/supabaseClient.js");
const getCurrentUser = require("../middleware/getCurrentUser"); //this routes require an authenticated user; attaches req.userId
router.use(getCurrentUser);

const ADMIN_ROLE_ID = 1;

// ✅ Get all admins
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sys_user')
      .select('sys_user_id, sys_user_email, sys_user_is_active, supabase_user_id')
      .eq('role_id', ADMIN_ROLE_ID)
      .order('sys_user_email', { ascending: true });

    if (error) throw error;

    res.status(200).json({
      admins: data,
      currentUserId: req.userId, // ✅ include logged-in user's ID
    });
  } catch (err) {
    console.error('Error fetching admins:', err.message);
    res.status(500).json({ error: 'Failed to fetch admins' });
  }
});


// ✅ Add a new admin
router.post("/", async (req, res) => {
  const { sys_user_email, sys_user_password, sys_user_created_by } = req.body;
  if (!sys_user_email || !sys_user_password || !sys_user_created_by) {
    return res
      .status(400)
      .json({ error: "Email, password, and created_by are required" });
  }

  try {
    // ✅ Create user in Supabase Auth
    const {
      data: createdUser,
      error: authErr,
    } = await supabase.auth.admin.createUser({
      email: sys_user_email,
      password: sys_user_password,
      email_confirm: true,
    });

    if (authErr) {
      console.error("Supabase Auth error:", authErr.message);
      return res.status(400).json({ error: authErr.message });
    }

    const supabaseUserId = createdUser.user.id;

    // ✅ Insert into system_user table
    const { data, error } = await supabase
      .from("system_user")
      .insert([
        {
          sys_user_email,
          sys_user_is_active: true,
          role_id: ADMIN_ROLE_ID,
          sys_user_created_by,
          sys_user_updated_by: sys_user_created_by,
          supabase_user_id: supabaseUserId, // ✅ Linked to Supabase Auth
        },
      ])
      .select(
        "sys_user_id, sys_user_email, sys_user_is_active, supabase_user_id"
      )
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    console.error("Error adding admin:", err.message);
    res.status(500).json({ error: "Failed to add admin" });
  }
});

// ✅ Update an existing admin
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    sys_user_email,
    sys_user_password,
    sys_user_is_active,
    sys_user_updated_by,
  } = req.body;

  if (!sys_user_updated_by) {
    return res.status(400).json({ error: "sys_user_updated_by is required" });
  }

  try {
    // ✅ Fetch supabase_user_id
    const { data: existingUser, error: fetchErr } = await supabase
      .from("system_user")
      .select("supabase_user_id")
      .eq("sys_user_id", id)
      .single();

    if (fetchErr || !existingUser) throw new Error("User not found");

    const supabaseUserId = existingUser.supabase_user_id;

    // ✅ Update in Supabase Auth if needed
    if (sys_user_email || sys_user_password) {
      const updates = {};
      if (sys_user_email) updates.email = sys_user_email;
      if (sys_user_password && sys_user_password.trim() !== "") {
        updates.password = sys_user_password;
      }
      if (Object.keys(updates).length > 0) {
        const {
          error: authUpdateErr,
        } = await supabase.auth.admin.updateUserById(supabaseUserId, updates);
        if (authUpdateErr) throw new Error(authUpdateErr.message);
      }
    }

    // ✅ Update in system_user table
    const updateData = {
      sys_user_updated_by,
      sys_user_updated_at: new Date(),
      role_id: ADMIN_ROLE_ID,
    };

    if (sys_user_email !== undefined)
      updateData.sys_user_email = sys_user_email;
    if (sys_user_is_active !== undefined)
      updateData.sys_user_is_active = sys_user_is_active;

    const { data, error } = await supabase
      .from("system_user")
      .update(updateData)
      .eq("sys_user_id", id)
      .select(
        "sys_user_id, sys_user_email, sys_user_is_active, supabase_user_id"
      )
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error("Error updating admin:", err.message);
    res.status(500).json({ error: "Failed to update admin" });
  }
});

// ✅ Toggle active status (also disable/enable Supabase Auth)
router.put("/:id/toggle", async (req, res) => {
  const { id } = req.params;
  const { sys_user_is_active, sys_user_updated_by } = req.body;

  if (typeof sys_user_is_active !== "boolean" || !sys_user_updated_by) {
    return res
      .status(400)
      .json({
        error:
          "sys_user_is_active (boolean) and sys_user_updated_by are required",
      });
  }

  try {
    // ✅ Fetch supabase_user_id
    const { data: existingUser, error: fetchErr } = await supabase
      .from("system_user")
      .select("supabase_user_id")
      .eq("sys_user_id", id)
      .single();

    if (fetchErr || !existingUser) throw new Error("User not found");

    const supabaseUserId = existingUser.supabase_user_id;

    // ✅ Disable or enable Supabase Auth account
    const { error: disableErr } = await supabase.auth.admin.updateUserById(
      supabaseUserId,
      {
        ban: !sys_user_is_active, // ✅ Supabase uses `ban` to disable login
      }
    );
    if (disableErr) throw new Error(disableErr.message);

    // ✅ Update in system_user
    const { data, error } = await supabase
      .from("system_user")
      .update({
        sys_user_is_active,
        sys_user_updated_at: new Date(),
        sys_user_updated_by,
        role_id: ADMIN_ROLE_ID,
      })
      .eq("sys_user_id", id)
      .select(
        "sys_user_id, sys_user_email, sys_user_is_active, supabase_user_id"
      )
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error("Error toggling admin active status:", err.message);
    res.status(500).json({ error: "Failed to toggle admin status" });
  }
});

module.exports = router;
