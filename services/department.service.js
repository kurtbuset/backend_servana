const supabase = require("../helpers/supabaseClient");

class DepartmentService {
  /**
   * Get all departments
   */
  async getAllDepartments() {
    const { data, error } = await supabase
      .from("department")
      .select("*")
      .order("dept_name", { ascending: true });

    if (error) throw error;
    return data;
  }

  /**
   * Create a new department
   */
  async createDepartment(deptName, createdBy) {
    const { data, error } = await supabase
      .from("department")
      .insert([
        {
          dept_name: deptName,
          dept_created_by: createdBy,
          dept_updated_by: createdBy,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update a department
   */
  async updateDepartment(deptId, updateData) {
    const { data, error } = await supabase
      .from("department")
      .update(updateData)
      .eq("dept_id", deptId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Toggle department active status
   */
  async toggleDepartmentStatus(deptId, isActive, updatedBy) {
    const { data, error } = await supabase
      .from("department")
      .update({
        dept_is_active: isActive,
        dept_updated_at: new Date(),
        dept_updated_by: updatedBy,
      })
      .eq("dept_id", deptId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get all members of a department from sys_user_department table
   */
  async getDepartmentMembers(deptId) {
    console.log(`🔍 Department Service - Fetching members for dept_id: ${deptId}`);

    try {
      const { data: userDepartments, error } = await supabase
        .from("sys_user_department")
        .select(`
          sys_user_id,
          sys_user (
            sys_user_id,
            sys_user_email,
            sys_user_is_active,
            role_id,
            role (
              role_id,
              role_name
            )
          )
        `)
        .eq("dept_id", deptId);

      if (error) {
        console.error("❌ Error fetching department members:", error);
        throw error;
      }

      console.log(`🔍 Raw query result:`, userDepartments);

      if (!userDepartments || userDepartments.length === 0) {
        console.log(`⚠️ No members found in sys_user_department for dept_id: ${deptId}`);
        return [];
      }

      // Now fetch profile and image data for each user
      const memberPromises = userDepartments
        .filter(ud => ud.sys_user)
        .map(async (ud) => {
          const userId = ud.sys_user.sys_user_id;

          // First get the sys_user to get prof_id
          const { data: userWithProf } = await supabase
            .from("sys_user")
            .select("prof_id")
            .eq("sys_user_id", userId)
            .single();

          let profile = null;
          let image = null;

          // If user has a prof_id, fetch profile and image
          if (userWithProf?.prof_id) {
            // Fetch profile
            const { data: profileData } = await supabase
              .from("profile")
              .select("*")
              .eq("prof_id", userWithProf.prof_id)
              .single();

            profile = profileData;

            // Fetch current image using prof_id
            const { data: imageData } = await supabase
              .from("image")
              .select("*")
              .eq("prof_id", userWithProf.prof_id)
              .eq("img_is_current", true)
              .single();

            image = imageData;
          }

          console.log(`👤 User ${userId} - Profile:`, profile ? `${profile.prof_firstname} ${profile.prof_lastname}` : 'Not found', '| Image:', image ? image.img_location : 'Not found');

          return {
            sys_user_id: ud.sys_user.sys_user_id,
            sys_user_email: ud.sys_user.sys_user_email,
            sys_user_is_active: ud.sys_user.sys_user_is_active,
            role: ud.sys_user.role,
            profile: profile || null,
            image: image || null
          };
        });

      const members = await Promise.all(memberPromises);
      console.log(`✅ Processed ${members.length} members`);
      return members;
    } catch (error) {
      console.error("❌ Exception in getDepartmentMembers:", error);
      throw error;
    }
  }
}

module.exports = new DepartmentService();
