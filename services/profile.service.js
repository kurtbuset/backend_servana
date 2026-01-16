const supabase = require("../helpers/supabaseClient");
const { v4: uuidv4 } = require("uuid");

class ProfileService {
  /**
   * Fetch user and profile data
   */
  async fetchUserAndProfile(sysUserId) {
    // Fetch system_user with role_name from role table
    const { data: userRow, error: userErr } = await supabase
      .from("sys_user")
      .select("sys_user_id, sys_user_email, prof_id, role_id, role:role_id(role_name)")
      .eq("sys_user_id", sysUserId)
      .single();

    if (userErr || !userRow) {
      throw new Error("User not found");
    }

    // Fetch profile
    const { data: profRow, error: profErr } = await supabase
      .from("profile")
      .select(
        "prof_id, prof_firstname, prof_middlename, prof_lastname, prof_address, prof_date_of_birth"
      )
      .eq("prof_id", userRow.prof_id)
      .single();

    if (profErr || !profRow) {
      throw new Error("Profile not found");
    }

    return { userRow, profRow };
  }

  /**
   * Fetch current or most recent profile image
   */
  async fetchCurrentImage(profId) {
    let { data: imgRows, error: imgErr } = await supabase
      .from("image")
      .select("img_id, img_location, img_is_current, img_created_at")
      .eq("prof_id", profId)
      .order("img_is_current", { ascending: false })
      .order("img_created_at", { ascending: false })
      .limit(1);

    if (imgErr) {
      console.error("Profile image fetch error:", imgErr.message);
      return null;
    }

    return imgRows && imgRows.length > 0 ? imgRows[0] : null;
  }

  /**
   * Update user email
   */
  async updateUserEmail(sysUserId, email) {
    const { error } = await supabase
      .from("sys_user")
      .update({
        sys_user_email: email,
        sys_user_updated_at: new Date().toISOString(),
      })
      .eq("sys_user_id", sysUserId);

    if (error) throw error;
  }

  /**
   * Update profile information
   */
  async updateProfile(profId, profileData) {
    const { error } = await supabase
      .from("profile")
      .update({
        prof_firstname: profileData.firstName,
        prof_middlename: profileData.middleName,
        prof_lastname: profileData.lastName,
        prof_address: profileData.address,
        prof_date_of_birth: profileData.dateOfBirth || null,
        prof_updated_at: new Date().toISOString(),
      })
      .eq("prof_id", profId);

    if (error) throw error;
  }

  /**
   * Get profile ID for a user
   */
  async getProfileId(sysUserId) {
    const { data: userRow, error: userErr } = await supabase
      .from("sys_user")
      .select("prof_id")
      .eq("sys_user_id", sysUserId)
      .single();

    if (userErr || !userRow) {
      throw new Error("User not found");
    }

    return userRow.prof_id;
  }

  /**
   * Upload profile image to storage
   */
  async uploadImageToStorage(profId, file) {
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

    return publicData.publicUrl;
  }

  /**
   * Unset previous current images
   */
  async unsetPreviousCurrentImages(profId) {
    const { data: existingImages, error: existingErr } = await supabase
      .from("image")
      .select("img_id")
      .eq("prof_id", profId)
      .eq("img_is_current", true);

    if (existingErr) {
      console.warn("Warning: Failed to check existing images:", existingErr.message);
      return;
    }

    if (existingImages && existingImages.length > 0) {
      await supabase
        .from("image")
        .update({ img_is_current: false })
        .eq("prof_id", profId)
        .eq("img_is_current", true);
    }
  }

  /**
   * Insert new profile image
   */
  async insertProfileImage(profId, imageUrl) {
    const { data: inserted, error: insertErr } = await supabase
      .from("image")
      .insert({
        prof_id: profId,
        img_location: imageUrl,
        img_is_current: true,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    return inserted;
  }
}

module.exports = new ProfileService();
