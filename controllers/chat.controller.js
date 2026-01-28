const express = require("express");
const chatService = require("../services/chat.service");
const getCurrentUser = require("../middleware/getCurrentUser");

class ChatController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    // Get canned messages for current user's role
    router.get("/canned-messages", (req, res) => this.getCannedMessages(req, res));

    // Get all chat groups for current user
    router.get("/chatgroups", (req, res) => this.getChatGroups(req, res));

    // Transfer chat group to another department
    router.post("/:chatGroupId/transfer", (req, res) => this.transferChatGroup(req, res));

    // Get chat messages for a specific client
    router.get("/:clientId", (req, res) => this.getChatMessages(req, res));

    return router;
  }
  /**
   * Get canned messages for the current user's role - Optimized with caching
   */
  async getCannedMessages(req, res) {
    try {
      const { userId } = req;

      // Use cached user role lookup
      const roleId = await chatService.getUserRole(userId);
      const messages = await chatService.getCannedMessagesByRole(roleId);

      res.json(messages);
    } catch (err) {
      console.error("❌ Error fetching canned messages:", err);
      res.status(500).json({ error: "Failed to fetch canned messages" });
    }
  }

  /**
   * Get all chat groups for the current user - Optimized
   */
  async getChatGroups(req, res) {
    try {
      const { userId } = req;

      const groups = await chatService.getChatGroupsByUser(userId);

      if (!groups || groups.length === 0) {
        return res.json([]);
      }

      // Extract profile IDs and chat group IDs more efficiently
      const profIds = [];
      const chatGroupIds = [];

      // Single pass to extract both arrays
      groups.forEach((group) => {
        chatGroupIds.push(group.chat_group_id);
        if (group.client?.prof_id) {
          profIds.push(group.client.prof_id);
        }
      });

      // Get profile images and latest message times in parallel
      const [imageMap, timeMap] = await Promise.all([
        profIds.length > 0 ? chatService.getProfileImages(profIds) : Promise.resolve({}),
        chatService.getLatestMessageTimes(chatGroupIds),
      ]);

      // Format response more efficiently
      const formatted = groups.reduce((acc, group) => {
        const client = group.client;
        if (!client) return acc;

        const fullName = client.profile
          ? `${client.profile.prof_firstname} ${client.profile.prof_lastname}`.trim()
          : "Unknown Client";

        // Get latest message time or use current time as fallback
        const latestTime = timeMap[group.chat_group_id];
        const displayTime = latestTime
          ? new Date(latestTime).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
          : new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

        acc.push({
          sys_user_id: userId,
          chat_group_id: group.chat_group_id,
          chat_group_name: fullName,
          department: group.department?.dept_name || "Unknown",
          customer: {
            id: client.client_id,
            chat_group_id: group.chat_group_id,
            name: fullName,
            number: client.client_number,
            profile: imageMap[client.prof_id] || null,
            time: displayTime,
            isAccepted: true, // Active chats are always accepted
            sys_user_id: group.sys_user_id, // Include the assigned user ID
            status: "active", // Only active chats are returned
          },
        });

        return acc;
      }, []);

      res.json(formatted);
    } catch (err) {
      console.error("❌ Error fetching chat groups:", err);
      res.status(500).json({ error: "Failed to fetch chat groups" });
    }
  }

  /**
   * Transfer chat group to another department
   */
  async transferChatGroup(req, res) {
    try {
      const { chatGroupId } = req.params;
      const { deptId } = req.body;
      const { userId } = req;

      if (!chatGroupId || !deptId) {
        return res.status(400).json({
          error: "Chat group ID and department ID are required"
        });
      }

      const transferredChat = await chatService.transferChatGroup(chatGroupId, deptId, userId);

      res.json({
        success: true,
        message: "Chat transferred successfully",
        data: {
          chat_group_id: transferredChat.chat_group_id,
          dept_id: transferredChat.dept_id,
          status: transferredChat.status,
          sys_user_id: transferredChat.sys_user_id
        }
      });
    } catch (err) {
      console.error("❌ Error transferring chat:", err);

      if (err.message === "Chat group not found or you don't have permission to transfer it") {
        return res.status(404).json({ error: err.message });
      }

      res.status(500).json({ error: "Failed to transfer chat" });
    }
  }

  /**
   * Get chat messages for a specific client
   */
  async getChatMessages(req, res) {
    try {
      const { clientId } = req.params;
      const { before, limit = 10 } = req.query;
      const { userId } = req;

      const messages = await chatService.getChatMessages(clientId, before, limit, userId);

      res.json({ messages });
    } catch (err) {
      console.error("❌ Error fetching chat messages:", err);

      if (err.message === "Chat group not found") {
        return res.status(404).json({ error: err.message });
      }

      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Handle sending a message via WebSocket
   */
  async handleSendMessage(rawMessage, io, socket) {
    try {
      // Validate that sys_user_id is provided from frontend
      if (!rawMessage.sys_user_id) {
        throw new Error("sys_user_id is required");
      }

      // Use the sys_user_id from frontend (which comes from fresh login session)
      // instead of socket authentication (which may be stale after logout/login)
      const message = {
        ...rawMessage,
        sys_user_id: rawMessage.sys_user_id, // Trust the frontend's authenticated user ID
      };

      console.log("Saving message to database:", message);

      // Insert message into database
      const insertedMessage = await chatService.insertMessage(message);

      if (insertedMessage) {
        // Emit update to refresh chat groups list
        io.emit("updateChatGroups");

        // Return the inserted message for socket handler to broadcast
        return insertedMessage;
      }

      return null;
    } catch (err) {
      console.error("❌ handleSendMessage error:", err.message);
      throw err;
    }
  }
}

module.exports = new ChatController();
