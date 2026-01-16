const supabase = require("../../helpers/supabaseClient");

class MobileDepartmentService {
  /**
   * Get all active departments
   */
  async getActiveDepartments() {
    const { data, error } = await supabase
      .from("department")
      .select("*")
      .eq("dept_is_active", true)
      .order("dept_name", { ascending: true });

    if (error) throw error;
    return data;
  }
}

module.exports = new MobileDepartmentService();
