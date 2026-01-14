const express = require('express');
const router = express.Router();
const supabase = require('../helpers/supabaseClient');
const getCurrentUser = require("../middleware/getCurrentUser"); //this routes require an authenticated user; attaches req.userId
router.use(getCurrentUser);

// GET all users with their roles
router.get('/', async (req, res) => {
  try {
    const { data: users, error: userError } = await supabase
      .from('system_user')
      .select(`
        sys_user_id,
        sys_user_email,
        sys_user_is_active,
        role_id
      `)
      .order('sys_user_email', { ascending: true });

    if (userError) throw userError;

    // Get all roles
    const { data: roles, error: roleError } = await supabase
      .from('role')
      .select('role_id, role_name')
      .eq('role_is_active', true);

    if (roleError) throw roleError;

    // Combine the data
    const response = users.map(user => ({
      sys_user_id: user.sys_user_id,
      sys_user_email: user.sys_user_email,
      sys_user_is_active: user.sys_user_is_active,
      role_id: user.role_id,
      // Include all roles in the response if needed
      all_roles: roles
    }));

    res.status(200).json(response);
  } catch (err) {
    console.error('Error fetching users:', err.message);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET all roles (active + inactive)
router.get('/roles', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('role')
      .select('role_id, role_name, role_is_active') // include active status
      .order('role_name', { ascending: true });
    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error('Error fetching roles:', err.message);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// PUT update a user's role or active status
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { role_id, sys_user_is_active } = req.body;

  const updateData = {
    sys_user_updated_at: new Date(),
    sys_user_updated_by: req.user?.sys_user_id || null // Assuming you have user in request
  };

  if (role_id !== undefined) updateData.role_id = role_id;
  if (typeof sys_user_is_active === 'boolean') updateData.sys_user_is_active = sys_user_is_active;

  try {
    const { data, error } = await supabase
      .from('system_user')
      .update(updateData)
      .eq('sys_user_id', id)
      .select('sys_user_id, sys_user_email, role_id, sys_user_is_active')
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error('Error updating user:', err.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

module.exports = router;