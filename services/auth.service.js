const supabase = require("../helpers/supabaseClient");
const { AGENT_STATUS_VALUES } = require("../constants/statuses");

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
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('❌ Supabase auth error:', error.message);
        throw error;
      }
      
      console.log('✅ Authentication successful for:', email);
      return data;
    } catch (error) {
      console.error('❌ Authentication failed:', error.message);
      
      // Provide more specific error messages
      if (error.message.includes('fetch failed') || error.message.includes('ECONNRESET')) {
        throw new Error('Database connection failed. Please check if Supabase is running.');
      }
      
      throw error;
    }
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

  /**
   * Refresh session using refresh token
   */
  async refreshSession(refreshToken) {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error) {
      throw new Error("Token refresh failed: " + error.message);
    }

    if (!data?.session || !data?.user) {
      throw new Error("No session data returned");
    }

    return data;
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(userId, status) {
    const validStatuses = AGENT_STATUS_VALUES;
    
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid agent status: ${status}`);
    }

    const { data, error } = await supabase
      .from("sys_user")
      .update({ agent_status: status })
      .eq("sys_user_id", userId)
      .select();

    if (error) throw error;
    return data;
  }
}

module.exports = new AuthService();
