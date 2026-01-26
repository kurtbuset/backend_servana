const express = require("express");
const authService = require("../services/auth.service");

class AuthController {
  getRouter() {
    const router = express.Router();

    // Login
    router.post("/login", (req, res) => this.login(req, res));

    // Check authentication
    router.get("/me", (req, res) => this.checkAuth(req, res));

    // Get user ID
    router.get("/user-id", (req, res) => this.getUserId(req, res));

    // Logout
    router.post("/logout", (req, res) => this.logout(req, res));

    return router;
  }
  /**
   * Login user
   */
  async login(req, res) {
    try {
      const email = authService.normalizeEmail(req.body.email);
      const { password } = req.body;

      // Login with Supabase Auth
      const { session, user } = await authService.signInWithPassword(email, password);

      if (!session || !user) {
        return res.status(500).json({ error: "Login failed" });
      }

      // Set secure cookies
      res.cookie("access_token", session.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production" ? "none" : "strict",
        sameSite: "strict",
        maxAge: 24 * 60 * 60 * 1000, // 1 day
      });

      res.cookie("refresh_token", session.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production" ? "none" : "strict",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      // Link with system_user
      const sysUser = await authService.getSystemUserBySupabaseId(user.id);

      res.json({
        message: "Login successful",
        user: { sys_user_id: sysUser.sys_user_id, role_id: sysUser.role_id },
      });
    } catch (err) {
      console.error("Login error:", err.message);

      if (err.message === "Account not linked or inactive") {
        return res.status(403).json({ error: err.message });
      }

      res.status(401).json({ error: err.message });
    }
  }

  /**
   * Check if user is authenticated
   */
  async checkAuth(req, res) {
    try {
      const token = req.cookies.access_token;

      if (!token) {
        return res.sendStatus(401);
      }

      await authService.getUserFromToken(token);
      res.sendStatus(200);
    } catch (err) {
      res.sendStatus(401);
    }
  }

  /**
   * Get user ID from token
   */
  async getUserId(req, res) {
    try {
      const token = req.cookies.access_token;

      if (!token) {
        return res.sendStatus(401);
      }

      const sysUserId = await authService.getSystemUserIdFromToken(token);

      res.json({ sys_user_id: sysUserId });
    } catch (err) {
      console.error("Get user ID error:", err.message);

      if (err.message === "sys_user not found for authenticated user") {
        return res.status(404).json({ error: err.message });
      }

      res.sendStatus(401);
    }
  }

  /**
   * Logout user
   */
  logout(req, res) {
    res.clearCookie("access_token");
    res.clearCookie("refresh_token");
    res.json({ message: "Logged out" });
  }
}

module.exports = new AuthController();
