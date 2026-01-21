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
}

module.exports = new DepartmentService();
