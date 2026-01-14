const express = require('express');
const router = express.Router();
const supabase = require('../helpers/supabaseClient.js');
const getCurrentUser = require("../middleware/getCurrentUser"); //this routes require an authenticated user; attaches req.userId
router.use(getCurrentUser);

// Get all departments
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('department')
      .select('*')
      .order('dept_name', { ascending: true });

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error('Error fetching departments:', err.message);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// Add a new department
router.post('/', async (req, res) => {
  const { dept_name, dept_created_by } = req.body;

  if (!dept_name || !dept_created_by) {
    return res.status(400).json({ error: 'dept_name and dept_created_by are required' });
  }

  try {
    const { data, error } = await supabase
      .from('department')
      .insert([
        {
          dept_name,
          dept_created_by,
          dept_updated_by: dept_created_by,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    console.error('Error adding department:', err.message);
    res.status(500).json({ error: 'Failed to add department' });
  }
});

// Update an existing department (name and active status)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { dept_name, dept_is_active, dept_updated_by } = req.body;

  if (!dept_updated_by) {
    return res.status(400).json({ error: 'dept_updated_by is required' });
  }

  try {
    const updateData = {
      dept_updated_at: new Date(),
      dept_updated_by,
    };

    if (dept_name !== undefined) updateData.dept_name = dept_name;
    if (dept_is_active !== undefined) updateData.dept_is_active = dept_is_active;

    const { data, error } = await supabase
      .from('department')
      .update(updateData)
      .eq('dept_id', id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error('Error updating department:', err.message);
    res.status(500).json({ error: 'Failed to update department' });
  }
});

// Toggle dept_is_active status separately
router.put('/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const { dept_is_active, dept_updated_by } = req.body;

  if (typeof dept_is_active !== 'boolean' || !dept_updated_by) {
    return res.status(400).json({ error: 'dept_is_active (boolean) and dept_updated_by are required' });
  }

  try {
    const { data, error } = await supabase
      .from('department')
      .update({
        dept_is_active,
        dept_updated_at: new Date(),
        dept_updated_by,
      })
      .eq('dept_id', id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error('Error toggling department active status:', err.message);
    res.status(500).json({ error: 'Failed to toggle department status' });
  }
});

module.exports = router;
