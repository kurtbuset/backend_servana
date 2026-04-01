const express = require("express");
const rateLimit = require("express-rate-limit");
const authService = require("../services/auth.service");
const profileService = require("../services/profile.service");
const sessionService = require("../services/session.service");
const config = require("../config/app");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

class AuthController {
  _cookieOptions(maxAge) {
    return { ...config.jwt.cookieOptions, maxAge };
  }

  getRouter() {
    const router = express.Router();

    // Login
    router.post("/login", loginLimiter, (req, res) => this.login(req, res));

    // Refresh token
    router.post("/refresh", (req, res) => this.refreshToken(req, res));

    // Check authentication
    router.get("/me", (req, res) => this.checkAuth(req, res));

    // Get user ID
    router.get("/user-id", (req, res) => this.getUserId(req, res));

    // Check Redis session
    router.get("/session", (req, res) => this.checkSession(req, res));

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

      // Link with system_user
      const sysUser = await authService.getSystemUserBySupabaseId(user.id);

      // Create session with cache manager
      const cache = req.app.get('cache');
      let sessionId = null;

      if (cache) {
        try {
          sessionId = await sessionService.createSession(cache, sysUser.sys_user_id, {
            email: user.email,
            role_id: sysUser.role_id,
            supabase_id: user.id
          });
          console.log(`🔑 Created session: ${sessionId} for user: ${sysUser.sys_user_id}`);
        } catch (error) {
          console.error('⚠️ Failed to create session:', error.message);
        }
      }

      // Set secure cookies
      res.cookie("access_token", session.access_token, this._cookieOptions(24 * 60 * 60 * 1000));
      res.cookie("refresh_token", session.refresh_token, this._cookieOptions(30 * 24 * 60 * 60 * 1000));

      if (sessionId) {
        res.cookie("session_id", sessionId, this._cookieOptions(24 * 60 * 60 * 1000));
      }

      res.json({
        data: {
          message: "Login successful",
          user: { sys_user_id: sysUser.sys_user_id, role_id: sysUser.role_id },
        }
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
   * Refresh access token using refresh token
   */
  async refreshToken(req, res) {
    try {
      const refreshToken = req.cookies.refresh_token || req.body.refresh_token;

      if (!refreshToken) {
        return res.status(401).json({ error: "No refresh token provided" });
      }

      // Refresh session with Supabase
      const { session, user } = await authService.refreshSession(refreshToken);

      if (!session || !user) {
        return res.status(401).json({ error: "Token refresh failed" });
      }

      // Update cookies with new tokens
      res.cookie("access_token", session.access_token, this._cookieOptions(24 * 60 * 60 * 1000));
      res.cookie("refresh_token", session.refresh_token, this._cookieOptions(30 * 24 * 60 * 60 * 1000));

      // Update session in cache if exists
      const sessionId = req.cookies.session_id;
      const cache = req.app.get('cache');

      if (cache && sessionId) {
        try {
          await sessionService.touchSession(cache, sessionId);
          console.log(`🔄 Refreshed session: ${sessionId}`);
        } catch (error) {
          console.error('⚠️ Failed to update session:', error.message);
        }
      }

      res.json({
        data: {
          message: "Token refreshed successfully",
        }
      });
    } catch (err) {
      console.error("Token refresh error:", err.message);

      // Clear invalid tokens
      res.clearCookie("access_token");
      res.clearCookie("refresh_token");

      res.status(401).json({ error: "Token refresh failed: " + err.message });
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

      res.json({ data: { sys_user_id: sysUserId } });
    } catch (err) {
      console.error("Get user ID error:", err.message);

      if (err.message === "sys_user not found for authenticated user") {
        return res.status(404).json({ error: err.message });
      }

      res.sendStatus(401);
    }
  }

  /**
   * Check session status
   */
  async checkSession(req, res) {
    try {
      const sessionId = req.cookies.session_id;
      const cache = req.app.get('cache');

      if (!cache) {
        return res.status(503).json({ error: "Cache not available" });
      }

      if (!sessionId) {
        return res.status(401).json({ error: "No session ID found" });
      }

      const sessionData = await sessionService.getSession(cache, sessionId);

      if (!sessionData) {
        return res.status(401).json({ error: "Session expired or invalid" });
      }

      res.json({
        data: {
          message: "Session valid",
          session: {
            userId: sessionData.userId,
            createdAt: sessionData.createdAt,
            lastAccessed: sessionData.lastAccessed
          }
        }
      });
    } catch (error) {
      console.error("Check session error:", error.message);
      res.status(500).json({ error: "Session check failed" });
    }
  }

  /**
   * Logout user
   */
  async logout(req, res) {
    try {
      const sessionId = req.cookies.session_id;
      const cache = req.app.get('cache');
      const token = req.cookies.access_token;

      // Get user ID to update user presence
      let userId = null;
      if (token) {
        try {
          userId = await authService.getSystemUserIdFromToken(token);
        } catch (err) {
          console.error('⚠️ Failed to get user ID from token:', err.message);
        }
      }

      // Delete session if it exists
      if (cache && sessionId) {
        try {
          await sessionService.deleteSession(cache, sessionId);
          console.log(`🔑 Deleted session: ${sessionId}`);
        } catch (error) {
          console.error('⚠️ Failed to delete session:', error.message);
        }
      }

      // Clear cookies with the same options used when setting them
      res.clearCookie("access_token", config.jwt.cookieOptions);
      res.clearCookie("refresh_token", config.jwt.cookieOptions);
      res.clearCookie("session_id", config.jwt.cookieOptions);

      res.json({ data: { message: "Logged out" } });
    } catch (error) {
      console.error("Logout error:", error.message);
      res.status(500).json({ error: "Logout failed" });
    }
  }
}

module.exports = new AuthController();
