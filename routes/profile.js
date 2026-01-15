// backend/routes/profile.js
const express = require("express");
const router = express.Router();
const supabase = require("../helpers/supabaseClient");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const getCurrentUser = require("../middleware/getCurrentUser"); 
const upload = multer({ storage: multer.memoryStorage() });

// All profile routes require an authenticated user; attaches req.userId
router.use(getCurrentUser);

/**
 * Utility: fetch minimal user+profile rows given sys_user_id.
 */
async function fetchUserAndProfile(sysUserId) {
  // 1) system_user with role information
  const {
    data: userRow,
    error: userErr,
  } = await supabase
    .from("sys_user")
    .select(`
      sys_user_id, 
      sys_user_email, 
      prof_id,
      role_id,
      role:role_id (
        role_id,
        role_name,
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
      )
    `)
    .eq("sys_user_id", sysUserId)
    .single();
  if (userErr || !userRow) {
    return { error: { status: 404, message: "User not found" } };
  }

  // 2) profile
  const {
    data: profRow,
    error: profErr,
  } = await supabase
    .from("profile")
    .select(
      "prof_id, prof_firstname, prof_middlename, prof_lastname, prof_address, prof_date_of_birth"
    )
    .eq("prof_id", userRow.prof_id)
    .single();
  if (profErr || !profRow) {
    return { error: { status: 404, message: "Profile not found" } };
  }

  return { userRow, profRow };
}

/**
 * Utility: fetch current/most recent profile image.
 */
async function fetchCurrentImage(profId) {
  let { data: imgRows, error: imgErr } = await supabase
    .from("image")
    .select("img_id, img_location, img_is_current, img_created_at")
    .eq("prof_id", profId)
    .order("img_is_current", { ascending: false }) // current first
    .order("img_created_at", { ascending: false }) // most recent next
    .limit(1);

  if (imgErr) {
    console.error("Profile image fetch error:", imgErr.message);
    imgRows = null;
  }
  return imgRows && imgRows.length > 0 ? imgRows[0] : null;
}

// ================= GET CURRENT USER PROFILE =================
// GET /profile
router.get("/", async (req, res) => {
  const sysUserId = req.userId;
  // console.log('sysUserId: ', sysUserId)
  try {
    const { userRow, profRow, error } = await fetchUserAndProfile(sysUserId);
    if (error) return res.status(error.status).json({ error: error.message });

    const image = await fetchCurrentImage(profRow.prof_id);

    res.json({
      sys_user_id: userRow.sys_user_id,
      sys_user_email: userRow.sys_user_email,
      role_id: userRow.role_id,
      role: userRow.role,
      profile: profRow,
      image,
    });
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ error: "Server error fetching profile" });
  }
});

// ================= UPDATE CURRENT USER PROFILE =================
// PUT /profile
router.put("/", async (req, res) => {
  const sysUserId = req.userId;
  const { firstName, middleName, lastName, email, address, dateOfBirth } = req.body;

  try {
    // get prof_id
    const {
      data: userRow,
      error: userErr,
    } = await supabase
      .from("sys_user")
      .select("prof_id")
      .eq("sys_user_id", sysUserId)
      .single();
    if (userErr || !userRow) {
      return res.status(404).json({ error: "User not found" });
    }
    const profId = userRow.prof_id;

    // Update email if provided (explicit undefined check allows empty string if you permit)
    if (email !== undefined) {
      const { error: emailErr } = await supabase
        .from("sys_user")
        .update({
          sys_user_email: email,
          sys_user_updated_at: new Date().toISOString(),
        })
        .eq("sys_user_id", sysUserId);
      if (emailErr) throw emailErr;
    }

    // Update profile fields
    const { error: profErr } = await supabase
      .from("profile")
      .update({
        prof_firstname: firstName,
        prof_middlename: middleName,
        prof_lastname: lastName,
        prof_address: address,
        prof_date_of_birth: dateOfBirth || null,
        prof_updated_at: new Date().toISOString(),
      })
      .eq("prof_id", profId);
    if (profErr) throw profErr;

    res.json({ message: "Profile updated successfully" });
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ error: "Server error updating profile" });
  }
});

// ================= UPLOAD CURRENT USER PROFILE IMAGE =================
// POST /profile/image
router.post("/image", upload.single("image"), async (req, res) => {
  const sysUserId = req.userId;
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No image uploaded" });

  try {
    // 1. Lookup prof_id
    const { data: userRow, error: userErr } = await supabase
      .from("sys_user")
      .select("prof_id")
      .eq("sys_user_id", sysUserId)
      .single();

    if (userErr || !userRow) {
      return res.status(404).json({ error: "User not found" });
    }
    const profId = userRow.prof_id;

    // 2. Upload file to Supabase Storage
    const ext = file.originalname.split(".").pop() || "png";
    const fileName = `${uuidv4()}.${ext}`;
    const filePath = `profile/${profId}/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from("profile-images")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (uploadErr) throw uploadErr;

    const { data: publicData, error: pubErr } = supabase.storage
      .from("profile-images")
      .getPublicUrl(filePath);
    if (pubErr) throw pubErr;
    const publicUrl = publicData.publicUrl;

    // 3. Unset previous image only if one exists
    const { data: existingImages, error: existingErr } = await supabase
      .from("image")
      .select("img_id")
      .eq("prof_id", profId)
      .eq("img_is_current", true);

    if (existingErr) {
      console.warn("Warning: Failed to check existing images:", existingErr.message);
    }

    if (existingImages && existingImages.length > 0) {
      await supabase
        .from("image")
        .update({ img_is_current: false })
        .eq("prof_id", profId)
        .eq("img_is_current", true);
    }

    // 4. Insert the new image as current
    const { data: inserted, error: insertErr } = await supabase
      .from("image")
      .insert({
        prof_id: profId,
        img_location: publicUrl,
        img_is_current: true,
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    return res.json({
      message: "Image uploaded successfully",
      img_location: publicUrl,
      image: inserted,
    });
  } catch (err) {
    console.error("Error uploading profile image:", err);
    return res.status(500).json({ error: "Server error uploading image" });
  }
});


  

module.exports = router;
