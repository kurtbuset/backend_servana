const supabase = require("../helpers/supabaseClient");

class AuthService {
  /**
   * Normalize email
   */
  normalizeEmail(email) {
    return (email || "").trim().toLowerCase();
  }

  /**
   * Sign in with Supabase Auth
   */
  async signInWithPassword(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Get system user by Supabase user ID
   */
  async getSystemUserBySupabaseId(supabaseUserId) {
    const { data: sysUser, error } = await supabase
      .from("sys_user")
      .select("sys_user_id, role_id, prof_id, sys_user_is_active, sys_user_email")
      .eq("supabase_user_id", supabaseUserId)
      .single();

    if (error || !sysUser || !sysUser.sys_user_is_active) {
      throw new Error("Account not linked or inactive");
    }

    return sysUser;
  }

  /**
   * Get user from token
   */
  async getUserFromToken(token) {
    const { data: authData, error } = await supabase.auth.getUser(token);

    if (error || !authData.user) {
      throw new Error("Invalid token");
    }

    return authData.user;
  }

  /**
   * Get system user ID from token
   */
  async getSystemUserIdFromToken(token) {
    const user = await this.getUserFromToken(token);
    const supabaseUserId = user.id;

    // Map the Supabase Auth UUID to our system_user table
    const { data: sysUser, error } = await supabase
      .from("sys_user")
      .select("sys_user_id")
      .eq("supabase_user_id", supabaseUserId)
      .single();

    if (error || !sysUser) {
      throw new Error("sys_user not found for authenticated user");
    }

    return sysUser.sys_user_id;
  }
}

module.exports = new AuthService();
