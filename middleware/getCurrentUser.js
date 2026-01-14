const supabase = require("../helpers/supabaseClient");

// Middleware to attach only sys_user_id to req.userId
const getCurrentUser = async (req, res, next) => {
  try {
    const token = req.cookies.access_token;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    // Validate token
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Fetch only sys_user_id
    const { data: sysUser, error: sysErr } = await supabase
      .from("sys_user")
      .select("sys_user_id")
      .eq("supabase_user_id", authData.user.id)
      .maybeSingle();

    if (sysErr || !sysUser) {
      return res.status(403).json({ error: "Account not linked or inactive" });
    }

    // Attach only the user ID
    req.userId = sysUser.sys_user_id;
    next();
  } catch (err) {
    console.error("getCurrentUser error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = getCurrentUser;
