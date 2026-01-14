const express = require("express");
const supabase = require("../helpers/supabaseClient");
const router = express.Router();

// Normalize email
const normalizeEmail = (email) => (email || "").trim().toLowerCase();

// POST /auth/login
router.post("/login", async (req, res) => {
  console.log('login')
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;

  // console.log('User details: ', req.body);


  // Login with Supabase Auth
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return res.status(401).json({ error: error.message });

  const { session, user } = data;
  if (!session || !user) return res.status(500).json({ error: "Login failed" });

  // Set secure cookies
  res.cookie("access_token", session.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  });
  res.cookie("refresh_token", session.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  // Link with system_user
  const { data: sysUser, error: sysErr } = await supabase
    .from("sys_user")
    // include email so Profile screen can show it
    .select("sys_user_id, role_id, prof_id, sys_user_is_active, sys_user_email")
    .eq("supabase_user_id", user.id)
    .single();

  if (sysErr || !sysUser || !sysUser.sys_user_is_active) {
    return res.status(403).json({ error: "Account not linked or inactive" });
  }

  res.json({
    message: "Login successful",
    user: { sys_user_id: sysUser.sys_user_id, role_id: sysUser.role_id },
  });
});

// GET /auth/me
router.get("/me", async (req, res) => {
  const token = req.cookies.access_token;
  if (!token) return res.sendStatus(401); // Not authenticated

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData.user) {
    return res.sendStatus(401); // Invalid token
  }

  res.sendStatus(200); // Authenticated but no extra data returned
  
});

router.get("/user-id", async (req, res) => {
  const token = req.cookies.access_token;
  if (!token) return res.sendStatus(401); // Not authenticated

  // Validate session via Supabase Auth
  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    return res.sendStatus(401); // Invalid token
  }

  const supabaseUserId = authData.user.id; // UUID from Supabase Auth

  // Map the Supabase Auth UUID to our system_user table
  const { data: sysUser, error: sysErr } = await supabase
    .from("sys_user")
    .select("sys_user_id")
    .eq("supabase_user_id", supabaseUserId)
    .single();

  if (sysErr || !sysUser) {
    // Auth exists but no matching system_user row
    return res
      .status(404)
      .json({ error: "sys_user not found for authenticated user" });
  }

  res.json({ sys_user_id: sysUser.sys_user_id });
});

// POST /auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie("access_token");
  res.clearCookie("refresh_token");
  res.json({ message: "Logged out" });
});

module.exports = router;
