const express = require('express');
const router = express.Router();
const supabase = require('../helpers/supabaseClient.js');
const getCurrentUser = require("../middleware/getCurrentUser"); //this routes require an authenticated user; attaches req.userId
router.use(getCurrentUser);

// GET /api/auto-replies - only auto replies with departments
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('auto_reply')
    .select(`
      auto_reply_id,
      auto_reply_message,
      auto_reply_is_active,
      dept_id,
      department:dept_id(dept_name, dept_is_active)
    `)
    .order('auto_reply_message', { ascending: true });

  if (error) return res.status(500).json({ error });
  res.json(data);
});

// GET /departments/active - return only active departments
router.get('/departments/active', async (req, res) => {
  const { data, error } = await supabase
    .from('department')
    .select('dept_id, dept_name')
    .eq('dept_is_active', true)
    .order('dept_name', { ascending: true });

  if (error) return res.status(500).json({ error });
  res.json(data);
});

// GET /departments/all - return all departments (including inactive)
router.get('/departments/all', async (req, res) => {
  const { data, error } = await supabase
    .from('department')
    .select('dept_id, dept_name, dept_is_active')
    .order('dept_name', { ascending: true });

  if (error) return res.status(500).json({ error });
  res.json(data);
});

// POST /api/auto-replies
router.post('/', async (req, res) => {
  const { message, dept_id, created_by } = req.body;

  if (!message || !dept_id || !created_by) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data, error } = await supabase
    .from('auto_reply')
    .insert([{
      auto_reply_message: message,
      dept_id,
      auto_reply_created_by: created_by,
      auto_reply_updated_by: created_by
    }])
    .select();

  if (error) return res.status(500).json({ error });
  res.status(201).json(data[0]);
});

// PUT /api/auto-replies/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { message, dept_id, updated_by } = req.body;

  const updateFields = {
    dept_id,
    auto_reply_updated_by: updated_by,
    auto_reply_updated_at: new Date()
  };

  if (message !== undefined) {
    updateFields.auto_reply_message = message;
  }

  const { data, error } = await supabase
    .from('auto_reply')
    .update(updateFields)
    .eq('auto_reply_id', id)
    .select();

  if (error) return res.status(500).json({ error });
  res.json(data[0]);
});

// PATCH /api/auto-replies/:id/toggle
router.patch('/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const { is_active, updated_by } = req.body;

  if (is_active === undefined || !updated_by) {
    return res.status(400).json({ error: 'Missing is_active or updated_by' });
  }

  const { data, error } = await supabase
    .from('auto_reply')
    .update({
      auto_reply_is_active: is_active,
      auto_reply_updated_by: updated_by,
      auto_reply_updated_at: new Date()
    })
    .eq('auto_reply_id', id)
    .select();

  if (error) return res.status(500).json({ error });
  res.json(data[0]);
});

module.exports = router;