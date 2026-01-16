const supabase = require("../helpers/supabaseClient");

class MacroService {
  /**
   * Get all macros for a specific role
   */
  async getMacrosByRole(roleId) {
    const { data: macros, error: macrosError } = await supabase
      .from("canned_message")
      .select(`
        canned_id,
        canned_message,
        canned_is_active,
        dept_id,
        department:department(dept_name, dept_is_active)
      `)
      .eq("role_id", roleId)
      .order("canned_message", { ascending: true });

    if (macrosError) throw macrosError;

    const { data: departments, error: deptError } = await supabase
      .from("department")
      .select("dept_id, dept_name, dept_is_active")
      .order("dept_name", { ascending: true });

    if (deptError) throw deptError;

    return {
      macros: macros.map((macro) => ({
        canned_id: macro.canned_id,
        canned_message: macro.canned_message,
        canned_is_active: macro.canned_is_active,
        dept_id: macro.dept_id,
        department: macro.department,
      })),
      departments,
    };
  }

  /**
   * Create a new macro
   */
  async createMacro(text, deptId, active, roleId, createdBy) {
    const { data, error } = await supabase
      .from("canned_message")
      .insert([
        {
          canned_message: text,
          canned_is_active: active,
          dept_id: deptId || null,
          role_id: roleId,
          canned_created_by: createdBy,
        },
      ])
      .select(`
        canned_id,
        canned_message,
        canned_is_active,
        dept_id,
        department:department(dept_name, dept_is_active)
      `)
      .single();

    if (error) throw error;

    return {
      id: data.canned_id,
      text: data.canned_message,
      active: data.canned_is_active,
      dept_id: data.dept_id,
      department: data.department?.dept_name || "All",
    };
  }

  /**
   * Update an existing macro
   */
  async updateMacro(macroId, text, active, deptId, updatedBy) {
    const { data, error } = await supabase
      .from("canned_message")
      .update({
        canned_message: text,
        canned_is_active: active,
        dept_id: deptId || null,
        canned_updated_by: updatedBy,
        canned_updated_at: new Date().toISOString(),
      })
      .eq("canned_id", macroId)
      .select(`
        canned_id,
        canned_message,
        canned_is_active,
        dept_id,
        department:department(dept_name, dept_is_active)
      `)
      .single();

    if (error) throw error;

    return {
      id: data.canned_id,
      text: data.canned_message,
      active: data.canned_is_active,
      dept_id: data.dept_id,
      department: data.department?.dept_name || "All",
    };
  }
}

module.exports = new MacroService();
