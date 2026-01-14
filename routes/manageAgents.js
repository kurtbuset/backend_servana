const express = require("express");
const router = express.Router();
const supabase = require("../helpers/supabaseClient.js");
const getCurrentUser = require("../middleware/getCurrentUser");

router.use(getCurrentUser);

// ✅ Fetch all agents with their departments
router.get("/agents", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("sys_user")
      .select(`
        sys_user_id,
        sys_user_email,
        sys_user_is_active,
        sys_user_department (
          department (
            dept_name
          )
        )
      `)
      .order("sys_user_email", { ascending: true });

    // if (error) throw error;
    if(error){
      throw error
    }

    const formattedAgents = data.map((agent) => ({
      id: agent.sys_user_id,
      email: agent.sys_user_email,
      active: agent.sys_user_is_active,
      departments: agent.sys_user_department.map((d) => d.department.dept_name),
    }));

    console.log('formattedAgents: ', formattedAgents)

    res.status(200).json(formattedAgents);
  } catch (err) {
    console.error("Error fetching agents:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Fetch all departments
router.get("/departments", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("department")
      .select("dept_name")
      .eq("dept_is_active", true);

    if (error) throw error;

    res.status(200).json(data.map((d) => d.dept_name));
  } catch (err) {
    console.error("Error fetching departments:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Update agent
router.put("/agents/:id", async (req, res) => {
  const { id } = req.params;
  const { email, active, departments, password } = req.body;

  try {
    const { data: sysUser, error: sysErr } = await supabase
      .from("system_user")
      .select("supabase_user_id")
      .eq("sys_user_id", id)
      .single();

    if (sysErr) throw sysErr;

    const authUserId = sysUser.supabase_user_id;

    const { error: updateUserError } = await supabase
      .from("system_user")
      .update({
        sys_user_email: email,
        sys_user_is_active: active,
        sys_user_updated_at: new Date(),
      })
      .eq("sys_user_id", id);

    if (updateUserError) throw updateUserError;

    // ✅ Update sys_user_department
    if (departments) {
      // 1. Delete existing
      await supabase.from("sys_user_department").delete().eq("sys_user_id", id);

      // 2. Get dept_id for each dept_name
      if (departments.length > 0) {
        const { data: deptRows, error: deptErr } = await supabase
          .from("department")
          .select("dept_id, dept_name")
          .in("dept_name", departments);

        if (deptErr) throw deptErr;

        const insertRows = deptRows.map((dept) => ({
          sys_user_id: id,
          dept_id: dept.dept_id,
        }));

        const { error: insertDeptError } = await supabase
          .from("sys_user_department")
          .insert(insertRows);

        if (insertDeptError) throw insertDeptError;
      }
    }

    // ✅ Update Supabase Auth
    if (authUserId) {
      const attrs = {};
      if (password?.length > 0) attrs.password = password;
      if (email) attrs.email = email;
      if (Object.keys(attrs).length > 0) {
        const { error: authErr } = await supabase.auth.admin.updateUserById(
          authUserId,
          attrs
        );
        if (authErr) throw authErr;
      }
    }

    res.status(200).json({ message: "Agent updated successfully" });
  } catch (err) {
    console.error("Error updating agent:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Create agent
router.post("/agents", async (req, res) => {
  const { email, password, departments, role_id } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    // 1. Create Supabase Auth user
    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError) throw authError;
    const authUserId = authUser.user.id;

    // 2. Insert system_user
    const { data: insertedUser, error: insertError } = await supabase
      .from("system_user")
      .insert({
        sys_user_email: email,
        sys_user_is_active: true,
        supabase_user_id: authUserId,
        sys_user_created_at: new Date(),
        role_id: role_id || 3,
      })
      .select("sys_user_id")
      .single();

    if (insertError) throw insertError;
    const newUserId = insertedUser.sys_user_id;

    // 3. Handle departments (name -> id)
    if (departments && departments.length > 0) {
      const { data: deptRows, error: deptErr } = await supabase
        .from("department")
        .select("dept_id, dept_name")
        .in("dept_name", departments);

      if (deptErr) throw deptErr;

      const insertRows = deptRows.map((dept) => ({
        sys_user_id: newUserId,
        dept_id: dept.dept_id,
      }));

      const { error: deptInsertErr } = await supabase
        .from("sys_user_department")
        .insert(insertRows);

      if (deptInsertErr) throw deptInsertErr;
    }

    res.status(201).json({ id: newUserId, email });
  } catch (err) {
    console.error("Error adding new agent:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
