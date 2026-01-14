const express = require('express');
const router = express.Router();
const supabase = require('../../helpers/supabaseClient.js');
const getCurrentMobileUser = require("../../middleware/getCurrentMobileUser.js") //this routes require an authenticated user; attaches req.userId


// GET all active departments
router.get("/active", async (req, res) => {
  const { data, error } = await supabase
    .from("department")
    .select("*")
    .eq("dept_is_active", true)
    .order("dept_name", { ascending: true });

  if (error) {
    console.error("Error fetching departments:", error);
    return res.status(500).json({ error: "Failed to fetch departments" });
  }

  res.json({ departments: data });
});

router.use(getCurrentMobileUser);
module.exports = router;
