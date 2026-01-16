const express = require("express");
const mobileMessageService = require("../../services/mobile/message.service");
const getCurrentMobileUser = require("../../middleware/getCurrentMobileUser");

class MobileMessageController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentMobileUser);

    // Create a new message
    router.post("/", (req, res) => this.createMessage(req, res));

    // Get messages by chat group ID
    router.get("/group/:id", (req, res) => this.getMessagesByGroupId(req, res));

    // Get latest chat group for current client
    router.get("/latest", (req, res) => this.getLatestChatGroup(req, res));

    // Create a new chat group
    router.post("/group/create", (req, res) => this.createChatGroup(req, res));

    return router;
  }
  /**
   * Create a new message
   */
  async createMessage(req, res) {
    try {
      const { chat_body, chat_group_id } = req.body;
      const client_id = req.userId;

      if (!chat_body || !chat_group_id || !client_id) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const data = await mobileMessageService.createMessage(chat_body, client_id, chat_group_id);

      res.status(201).json(data);
    } catch (err) {
      console.error("Failed to insert chat:", err.message);
      res.status(500).json({ error: "Failed to insert chat" });
    }
  }

  /**
   * Get messages by chat group ID
   */
  async getMessagesByGroupId(req, res) {
    try {
      const { id } = req.params;

      const data = await mobileMessageService.getMessagesByGroupId(id);

      res.json(data);
    } catch (err) {
      console.error("Failed to fetch messages:", err.message);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  }

  /**
   * Get latest chat group for current client
   */
  async getLatestChatGroup(req, res) {
    try {
      const clientId = req.userId;

      const chatGroupId = await mobileMessageService.getLatestChatGroup(clientId);

      res.status(200).json({ chat_group_id: chatGroupId });
    } catch (err) {
      console.error("❌ Could not retrieve latest chat group:", err.message);
      res.status(404).json({ error: err.message });
    }
  }

  /**
   * Create a new chat group
   */
  async createChatGroup(req, res) {
    try {
      const { department } = req.body;
      const clientId = req.userId;

      if (!department || !clientId) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const chatGroupId = await mobileMessageService.createChatGroup(department, clientId);

      res.status(201).json({ chat_group_id: chatGroupId });
    } catch (err) {
      console.error("Error creating chat group:", err.message);
      res.status(500).json({ error: "Failed to create chat group" });
    }
  }
}

module.exports = new MobileMessageController();
