const supabase = require("../helpers/supabaseClient");

class AutoReplyService {
  /**
   * Get all auto replies with department info
   */
  async getAllAutoReplies() {
    const { data, error } = await supabase
      .from("auto_reply")
      .select(`
        auto_reply_id,
        auto_reply_message,
        auto_reply_is_active,
        dept_id,
        department:dept_id(dept_name, dept_is_active)
      `)
      .order("auto_reply_message", { ascending: true });

    if (error) throw error;
    return data;
  }

  /**
   * Get active departments only
   */
  async getActiveDepartments() {
    const { data, error } = await supabase
      .from("department")
      .select("dept_id, dept_name")
      .eq("dept_is_active", true)
      .order("dept_name", { ascending: true });

    if (error) throw error;
    return data;
  }

  /**
   * Get all departments (including inactive)
   */
  async getAllDepartments() {
    const { data, error } = await supabase
      .from("department")
      .select("dept_id, dept_name, dept_is_active")
      .order("dept_name", { ascending: true });

    if (error) throw error;
    return data;
  }

  /**
   * Create a new auto reply
   */
  async createAutoReply(message, deptId, createdBy) {
    const { data, error } = await supabase
      .from("auto_reply")
      .insert([
        {
          auto_reply_message: message,
          dept_id: deptId,
          auto_reply_created_by: createdBy,
          auto_reply_updated_by: createdBy,
        },
      ])
      .select();

    if (error) throw error;
    return data[0];
  }

  /**
   * Update an auto reply
   */
  async updateAutoReply(autoReplyId, message, deptId, updatedBy) {
    const updateFields = {
      dept_id: deptId,
      auto_reply_updated_by: updatedBy,
      auto_reply_updated_at: new Date(),
    };

    if (message !== undefined) {
      updateFields.auto_reply_message = message;
    }

    const { data, error } = await supabase
      .from("auto_reply")
      .update(updateFields)
      .eq("auto_reply_id", autoReplyId)
      .select();

    if (error) throw error;
    return data[0];
  }

  /**
   * Toggle auto reply active status
   */
  async toggleAutoReplyStatus(autoReplyId, isActive, updatedBy) {
    const { data, error } = await supabase
      .from("auto_reply")
      .update({
        auto_reply_is_active: isActive,
        auto_reply_updated_by: updatedBy,
        auto_reply_updated_at: new Date(),
      })
      .eq("auto_reply_id", autoReplyId)
      .select();

    if (error) throw error;
    return data[0];
  }
}

module.exports = new AutoReplyService();
