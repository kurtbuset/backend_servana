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

    let profRow = null;

    // Only fetch profile if prof_id exists
    if (userRow.prof_id) {
      const { data: profileData, error: profErr } = await supabase
        .from("profile")
        .select(
          "prof_id, prof_firstname, prof_middlename, prof_lastname, prof_address, prof_date_of_birth"
        )
        .eq("prof_id", userRow.prof_id)
        .single();

      if (profErr) {
        console.warn(`⚠️ Profile fetch failed for prof_id ${userRow.prof_id}:`, profErr.message);
        // Don't throw error, just set profRow to null
      } else {
        profRow = profileData;
      }
    } else {
      console.warn(`⚠️ User ${sysUserId} has no prof_id - profile data will be null`);
    }

    // If no profile exists, create a minimal profile structure to prevent errors
    if (!profRow) {
      profRow = {
        prof_id: null,
        prof_firstname: '',
        prof_middlename: '',
        prof_lastname: '',
        prof_address: '',
        prof_date_of_birth: null
      };
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

  /**
   * Check if user has a specific permission
   */
  async checkUserPermission(sysUserId, permissionName) {
    try {
      // Get user's role_id
      const { data: userRow, error: userErr } = await supabase
        .from("sys_user")
        .select("role_id")
        .eq("sys_user_id", sysUserId)
        .single();

      if (userErr || !userRow?.role_id) {
        console.warn(`⚠️ User ${sysUserId} has no role assigned`);
        return false;
      }

      // Get role's priv_id
      const { data: roleData, error: roleError } = await supabase
        .from("role")
        .select("priv_id")
        .eq("role_id", userRow.role_id)
        .single();

      if (roleError || !roleData?.priv_id) {
        console.warn(`⚠️ Role ${userRow.role_id} has no privilege assigned`);
        return false;
      }

      // Check the specific permission
      const { data: privData, error: privError } = await supabase
        .from("privilege")
        .select(permissionName)
        .eq("priv_id", roleData.priv_id)
        .single();

      if (privError || !privData) {
        console.warn(`⚠️ Failed to fetch privilege ${permissionName} for priv_id ${roleData.priv_id}`);
        return false;
      }

      return privData[permissionName] === true;
    } catch (error) {
      console.error(`❌ Error checking permission ${permissionName} for user ${sysUserId}:`, error.message);
      return false;
    }
  }

  /**
   * Create a new profile with default values
   */
  async createProfile(profileData = {}) {
    try {
      const defaultProfile = {
        prof_firstname: profileData.firstName || '',
        prof_middlename: profileData.middleName || '',
        prof_lastname: profileData.lastName || '',
        prof_address: profileData.address || '',
        prof_date_of_birth: profileData.dateOfBirth || null,
      };

      console.log('📝 Creating profile with data:', defaultProfile);

      const { data: profile, error } = await supabase
        .from("profile")
        .insert(defaultProfile)
        .select()
        .single();

      if (error) {
        console.error('❌ Profile creation failed:', error);
        throw error;
      }

      console.log('✅ Profile created successfully:', profile.prof_id);
      return profile;
    } catch (error) {
      console.error('❌ Error in createProfile:', error.message);
      throw new Error(`Failed to create profile: ${error.message}`);
    }
  }

  /**
   * Create a minimal profile with empty default values
   */
  async createMinimalProfile() {
    try {
      console.log('📝 Creating minimal profile with default values');
      return await this.createProfile({});
    } catch (error) {
      console.error('❌ Error in createMinimalProfile:', error.message);
      throw error;
    }
  }

  /**
   * Check if user has a profile
   */
  async userHasProfile(sysUserId) {
    try {
      const { data: userRow, error: userErr } = await supabase
        .from("sys_user")
        .select("prof_id")
        .eq("sys_user_id", sysUserId)
        .single();

      if (userErr) {
        console.error(`❌ Error checking user profile: ${userErr.message}`);
        return false;
      }

      return userRow?.prof_id !== null;
    } catch (error) {
      console.error(`❌ Error in userHasProfile: ${error.message}`);
      return false;
    }
  }

  /**
   * Backfill missing profiles for users without prof_id
   */
  async backfillMissingProfiles() {
    try {
      console.log('🔄 Starting backfill process for users without profiles');

      // Find all users with null prof_id
      const { data: usersWithoutProfiles, error: fetchError } = await supabase
        .from("sys_user")
        .select("sys_user_id, sys_user_email")
        .is("prof_id", null);

      if (fetchError) {
        console.error('❌ Error fetching users without profiles:', fetchError);
        throw fetchError;
      }

      if (!usersWithoutProfiles || usersWithoutProfiles.length === 0) {
        console.log('✅ No users found without profiles');
        return { processed: 0, successful: 0, failed: 0 };
      }

      console.log(`📊 Found ${usersWithoutProfiles.length} users without profiles`);

      let successful = 0;
      let failed = 0;

      for (const user of usersWithoutProfiles) {
        try {
          console.log(`🔄 Processing user ${user.sys_user_id} (${user.sys_user_email})`);

          // Create minimal profile
          const profile = await this.createMinimalProfile();

          // Link profile to user
          const { error: updateError } = await supabase
            .from("sys_user")
            .update({ 
              prof_id: profile.prof_id,
              sys_user_updated_at: new Date().toISOString()
            })
            .eq("sys_user_id", user.sys_user_id);

          if (updateError) {
            console.error(`❌ Failed to link profile ${profile.prof_id} to user ${user.sys_user_id}:`, updateError);
            failed++;
          } else {
            console.log(`✅ Successfully created and linked profile ${profile.prof_id} for user ${user.sys_user_id}`);
            successful++;
          }
        } catch (error) {
          console.error(`❌ Failed to process user ${user.sys_user_id}:`, error.message);
          failed++;
        }
      }

      const result = {
        processed: usersWithoutProfiles.length,
        successful,
        failed
      };

      console.log('📊 Backfill process completed:', result);
      return result;
    } catch (error) {
      console.error('❌ Error in backfillMissingProfiles:', error.message);
      throw error;
    }
  }
}

module.exports = new ProfileService();
