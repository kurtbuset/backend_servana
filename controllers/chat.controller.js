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

    // Get chat messages for a specific client
    router.get("/:clientId", (req, res) => this.getChatMessages(req, res));

    return router;
  }
  /**
   * Get canned messages for the current user's role
   */
  async getCannedMessages(req, res) {
    try {
      const { userId } = req;

      const roleId = await chatService.getUserRole(userId);
      const messages = await chatService.getCannedMessagesByRole(roleId);

      res.json(messages);
    } catch (err) {
      console.error("❌ Error fetching canned messages:", err);
      res.status(500).json({ error: "Failed to fetch canned messages" });
    }
  }

  /**
   * Get all chat groups for the current user
   */
  async getChatGroups(req, res) {
    try {
      const { userId } = req;

      const groups = await chatService.getChatGroupsByUser(userId);

      if (!groups || groups.length === 0) {
        return res.json([]);
      }

      // Extract profile IDs
      const profIds = groups
        .map((g) => g.client?.prof_id)  
        .filter((id) => id !== undefined && id !== null);

      // Get profile images
      const imageMap = await chatService.getProfileImages(profIds);

      // Format response
      const formatted = groups.map((group) => {
        const client = group.client;
        if (!client) return null;

        const fullName = client.profile
          ? `${client.profile.prof_firstname} ${client.profile.prof_lastname}`
          : "Unknown Client";

        return {
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
            time: "9:00 AM",
          },
        };
      });

      res.json(formatted.filter(Boolean));
    } catch (err) {
      console.error("❌ Error fetching chat groups:", err);
      res.status(500).json({ error: "Failed to fetch chat groups" });
    }
  }

  /**
   * Get chat messages for a specific client
   */
  async getChatMessages(req, res) {
    try {
      const { clientId } = req.params;
      const { before, limit = 10 } = req.query;

      const messages = await chatService.getChatMessages(clientId, before, limit);

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
      const sysUserId = await chatService.authenticateSocketUser(socket);

      const message = {
        ...rawMessage,
        sys_user_id: sysUserId,
      };

      console.log("Sending message:", message);

      // Emit update to refresh chat groups list
      io.emit("updateChatGroups");

      // Insert message into database
      const insertedMessage = await chatService.insertMessage(message);

      if (insertedMessage) {
        // Broadcast message to the specific chat group
        io.to(String(message.chat_group_id)).emit("receiveMessage", insertedMessage);
      }
    } catch (err) {
      console.error("❌ handleSendMessage error:", err.message);
    }
  }
}

module.exports = new ChatController();
