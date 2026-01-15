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
  try {
    const { data, error } = await supabase
      .from("role")
      .select(`
        role_id,
        role_name,
        role_is_active,
        priv_id,
        privilege:priv_id (
          priv_can_view_message,
          priv_can_message,
          priv_can_manage_profile,
          priv_can_use_canned_mess,
          priv_can_end_chat,
          priv_can_transfer,
          priv_can_manage_dept,
          priv_can_assign_dept,
          priv_can_manage_role,
          priv_can_assign_role,
          priv_can_create_account,
          priv_can_manage_auto_reply
        )
      `)
      .order("role_id", { ascending: true });

    if (error) {
      console.error("Supabase error fetching roles:", error);
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.json([]);
    }

    const formatted = data.map((role) => {
      // Supabase returns foreign key joins as arrays, so take first element
      const privilegeData = Array.isArray(role.privilege) 
        ? role.privilege[0] 
        : role.privilege;

      // Build permissions array from privilege columns
      const permissions = [];
      if (privilegeData) {
        Object.entries(permissionMap).forEach(([label, column]) => {
          if (privilegeData[column] === true) {
            permissions.push(label);
          }
        });
      }

      return {
        role_id: role.role_id,
        name: role.role_name,
        active: role.role_is_active,
        permissions: permissions,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("Error in GET /roles:", err);
    res.status(500).json({ error: "Server error fetching roles" });
  }
});

// POST new role
router.post("/", async (req, res) => {
  try {
    // Check if user has permission to manage roles
    const { data: userData, error: userError } = await supabase
      .from("sys_user")
      .select(`
        role_id,
        role:role_id (
          privilege:priv_id (
            priv_can_manage_role
          )
        )
      `)
      .eq("sys_user_id", req.userId)
      .single();

    if (userError || !userData) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Admin (role_id = 1) or users with priv_can_manage_role permission
    const hasPermission = 
      userData.role_id === 1 || 
      (userData.role?.privilege?.[0]?.priv_can_manage_role === true);

    if (!hasPermission) {
      return res.status(403).json({ error: "You don't have permission to manage roles" });
    }

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
  } catch (err) {
    console.error("Error in POST /roles:", err);
    res.status(500).json({ error: "Server error creating role" });
  }
});

// PUT update existing role
router.put("/:id", async (req, res) => {
  try {
    const roleId = req.params.id;
    let { name, active, permissions, updated_by } = req.body;

    // Clean up the data - ensure no null strings
    name = name || '';
    active = Boolean(active);
    updated_by = updated_by ? parseInt(updated_by) : null;

    console.log("PUT /roles/:id - Request from user:", req.userId);
    console.log("PUT /roles/:id - Role ID:", roleId);
    console.log("PUT /roles/:id - Cleaned data:", { name, active, permissions, updated_by });

    // Check if user has permission to manage roles
    const { data: userData, error: userError } = await supabase
      .from("sys_user")
      .select(`
        sys_user_id,
        role_id,
        role:role_id (
          role_id,
          priv_id,
          privilege:priv_id (
            priv_can_manage_role
          )
        )
      `)
      .eq("sys_user_id", req.userId)
      .single();

    if (userError || !userData) {
      console.error("User not found or error:", userError);
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Admin (role_id = 1) or users with priv_can_manage_role permission
    const privilegeData = Array.isArray(userData.role?.privilege) 
      ? userData.role.privilege[0] 
      : userData.role?.privilege;

    const hasPermission = 
      userData.role_id === 1 || 
      (privilegeData?.priv_can_manage_role === true);

    if (!hasPermission) {
      return res.status(403).json({ error: "You don't have permission to manage roles" });
    }

    const { data: role, error: fetchError } = await supabase
      .from("role")
      .select("priv_id")
      .eq("role_id", roleId)
      .single();

    if (fetchError || !role) {
      console.error("Role not found:", fetchError);
      return res.status(404).json({ error: "Role not found" });
    }

    // Only update privileges if permissions are provided
    if (Array.isArray(permissions)) {
      const privPayload = buildPrivilegeFields(permissions);
      
      // Only add updated_by if it's a valid number
      if (updated_by) {
        privPayload.priv_updated_by = updated_by;
      }
      
      console.log("Updating privileges for priv_id:", role.priv_id);
      console.log("Privilege payload:", JSON.stringify(privPayload, null, 2));

      const { data: updateResult, error: privUpdateError } = await supabase
        .from("privilege")
        .update(privPayload)
        .eq("priv_id", role.priv_id)
        .select();

      if (privUpdateError) {
        console.error("Privilege update error details:", JSON.stringify(privUpdateError, null, 2));
        return res.status(500).json({ error: `Privilege update failed: ${privUpdateError.message}` });
      }

      console.log("Privilege update result:", updateResult);
    }

    // Update role - only update name and active status
    const roleUpdatePayload = {
      role_name: name,
      role_is_active: active,
    };

    // Only add updated_by if it's a valid number
    if (updated_by) {
      roleUpdatePayload.role_updated_by = updated_by;
    }

    console.log("Updating role with payload:", roleUpdatePayload);

    const { error: roleUpdateError } = await supabase
      .from("role")
      .update(roleUpdatePayload)
      .eq("role_id", roleId);

    if (roleUpdateError) {
      console.error("Role update error:", roleUpdateError);
      return res.status(500).json({ error: roleUpdateError.message });
    }

    console.log("Role updated successfully");
    res.json({ message: "Role updated" });
  } catch (err) {
    console.error("Error in PUT /roles/:id:", err);
    res.status(500).json({ error: "Server error updating role" });
  }
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


