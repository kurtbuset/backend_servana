const express = require("express");
const router = express.Router();
const supabase = require("../helpers/supabaseClient");
const getCurrentUser = require("../middleware/getCurrentUser"); //this routes require an authenticated user; attaches req.userId
router.use(getCurrentUser);

// Permission label-to-column mapping
const permissionMap = {
  "Can view Chats": "priv_can_view_message",
  "Can Reply": "priv_can_message",
  "Can Manage Profile": "priv_can_manage_profile",
  "Can send Macros": "priv_can_use_canned_mess",
  "Can End Chat": "priv_can_end_chat",
  "Can Transfer Department": "priv_can_transfer",
  "Can Edit Department": "priv_can_manage_dept",
  "Can Assign Department": "priv_can_assign_dept",
  "Can Edit Roles": "priv_can_manage_role",
  "Can Assign Roles": "priv_can_assign_role",
  "Can Add Admin Accounts": "priv_can_create_account",
  "Can Edit Auto-Replies": "priv_can_manage_auto_reply",
};

// GET all roles with permissions
router.get("/", async (req, res) => {
  const { data, error } = await supabase.from("role").select(`
      role_id,
      role_name,
      role_is_active,
      priv_id,
      privilege:priv_id (
        ${Object.values(permissionMap).join(", ")}
      )
    `)
    .order("role_id", { ascending: true });

  if (error) return res.status(500).json({ error });

  const formatted = data.map((role) => ({
    role_id: role.role_id,
    name: role.role_name,
    active: role.role_is_active,
    permissions: Object.entries(role.privilege || {})
      .filter(([, value]) => value === true)
      .map(([key]) =>
        Object.keys(permissionMap).find((k) => permissionMap[k] === key)
      )
      .filter(Boolean),
  }));

  res.json(formatted);
});

// POST new role
router.post("/", async (req, res) => {
  const { name, permissions, created_by } = req.body;

  const privPayload = buildPrivilegeFields(permissions);
  privPayload.priv_created_by = created_by;

  const { data: priv, error: privError } = await supabase
    .from("privilege")
    .insert([privPayload])
    .select("priv_id")
    .single();

  if (privError) return res.status(500).json({ error: privError.message });

  const { error: roleError, data: roleData } = await supabase
    .from("role")
    .insert([
      {
        role_name: name,
        role_is_active: true,
        priv_id: priv.priv_id,
        role_created_by: created_by,
      },
    ])
    .select("*");

  if (roleError) return res.status(500).json({ error: roleError.message });

  res.json({ message: "Role created", role: roleData });
});

// PUT update existing role
router.put("/:id", async (req, res) => {
  const roleId = req.params.id;
  const { name, active, permissions, updated_by } = req.body;

  const { data: role, error: fetchError } = await supabase
    .from("role")
    .select("priv_id")
    .eq("role_id", roleId)
    .single();

  if (fetchError || !role)
    return res.status(404).json({ error: "Role not found" });

  // Only update privileges if permissions are provided
  if (Array.isArray(permissions)) {
    const privPayload = buildPrivilegeFields(permissions);
    privPayload.priv_updated_by = updated_by;

    const { error: privUpdateError } = await supabase
      .from("privilege")
      .update(privPayload)
      .eq("priv_id", role.priv_id);

    if (privUpdateError)
      return res.status(500).json({ error: privUpdateError.message });
  }

  const { error: roleUpdateError } = await supabase
    .from("role")
    .update({
      role_name: name,
      role_is_active: active,
      role_updated_by: updated_by,
    })
    .eq("role_id", roleId);

  if (roleUpdateError)
    return res.status(500).json({ error: roleUpdateError.message });

  res.json({ message: "Role updated" });
});


// Helper
function buildPrivilegeFields(permissions = []) {
  const fields = {};
  Object.values(permissionMap).forEach((key) => (fields[key] = false));
  permissions.forEach((label) => {
    const key = permissionMap[label];
    if (key) fields[key] = true;
  });
  return fields;
}

module.exports = router;


