const express = require("express");
const authService = require("../services/auth.service");
const sessionService = require("../services/session.service");

class AuthController {
  getRouter() {
    const router = express.Router();

    // Login
    router.post("/login", (req, res) => this.login(req, res));

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

      // Set secure cookies (keeping original JWT approach)
      res.cookie("access_token", session.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        maxAge: 24 * 60 * 60 * 1000, // 1 day
      });

      res.cookie("refresh_token", session.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      // Also set Redis session ID cookie
      if (sessionId) {
        res.cookie("session_id", sessionId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          maxAge: 24 * 60 * 60 * 1000, // 1 day
        });
      }

      // Set agent_status to accepting_chats on login
      try {
        await authService.updateAgentStatus(sysUser.sys_user_id, 'accepting_chats');
        console.log(`✅ Set agent_status to accepting_chats for user: ${sysUser.sys_user_id}`);
        
        // Assign queued chats to newly logged in agent
        const agentAssignmentService = require('../services/agentAssignment.service');
        agentAssignmentService.assignQueuedChatsToAgent(sysUser.sys_user_id)
          .then(assignedChats => {
            if (assignedChats.length > 0) {
              console.log(`✅ Assigned ${assignedChats.length} queued chats to newly logged in agent ${sysUser.sys_user_id}`);
              
              // Broadcast assignments via Socket.IO notifier
              const io = req.app.get('io');
              if (io && io.socketConfig) {
                const notifier = io.socketConfig.getChatGroupNotifier();
                if (notifier) {
                  notifier.notifyQueuedChatsAssigned(assignedChats, sysUser.sys_user_id);
                }
              }
            }
          })
          .catch(err => {
            console.error('❌ Error assigning queued chats on login:', err.message);
          });
      } catch (statusErr) {
        console.error('⚠️ Error updating agent_status:', statusErr.message);
      }

      res.json({
        message: "Login successful",
        user: { sys_user_id: sysUser.sys_user_id, role_id: sysUser.role_id },
        session_id: sessionId // Include session ID in response
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
        message: "Session valid",
        session: {
          userId: sessionData.userId,
          email: sessionData.email,
          role_id: sessionData.role_id,
          createdAt: sessionData.createdAt,
          lastAccessed: sessionData.lastAccessed
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

      // Get user ID to update agent_status
      let userId = null;
      if (token) {
        try {
          userId = await authService.getSystemUserIdFromToken(token);
        } catch (err) {
          console.error('⚠️ Failed to get user ID from token:', err.message);
        }
      }

      // Set agent_status to offline on logout
      if (userId) {
        try {
          await authService.updateAgentStatus(userId, 'offline');
          console.log(`✅ Set agent_status to offline for user: ${userId}`);
        } catch (statusErr) {
          console.error('⚠️ Error updating agent_status on logout:', statusErr.message);
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
      res.clearCookie("access_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      });

      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      });

      res.clearCookie("session_id", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      });

      res.json({ message: "Logged out" });
    } catch (error) {
      console.error("Logout error:", error.message);
      res.status(500).json({ error: "Logout failed" });
    }
  }
}

module.exports = new AuthController();
