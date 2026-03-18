const express = require("express");
const mobileMessageService = require("../../services/mobile/message.service");
const getCurrentMobileUser = require("../../middleware/getCurrentMobileUser");

class MobileMessageController {
  getRouter() {
    const router = express.Router();

    // Apply authentication middleware to all routes
    router.use(getCurrentMobileUser);

    // Create a new message
    router.post("/", (req, res) => this.createMessage(req, res));

    // Get messages by chat group ID
    router.get("/group/:id", (req, res) => this.getMessagesByGroupId(req, res));

    // Get latest chat group for current client
    router.get("/latest", (req, res) => this.getLatestChatGroup(req, res));

    // Create a new chat group
    router.post("/group/create", (req, res) => this.createChatGroup(req, res));

    // End/resolve a chat group (mobile client)
    router.patch("/group/:id/end", (req, res) => this.endChatGroup(req, res));

    // Get resolved chats for current client
    router.get("/resolved", (req, res) => this.getResolvedChats(req, res));

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
   * Get messages by chat group ID with pagination
   */
  async getMessagesByGroupId(req, res) {
    try {
      const { id } = req.params;
      const { before, limit = 10 } = req.query;

      // Validate limit parameter
      const messageLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 50); // Between 1-50 messages

      const data = await mobileMessageService.getMessagesByGroupId(id, before, messageLimit);

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

      const chatGroup = await mobileMessageService.getLatestChatGroup(clientId);

      res.status(200).json(chatGroup);
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

      const result = await mobileMessageService.createChatGroup(department, clientId);

      // Emit socket notifications
      const io = req.app.get('io');
      if (io && io.socketConfig) {
        const notifier = io.socketConfig.getChatGroupNotifier();
        if (notifier) {
          notifier.notifyChatGroupCreated(result, result.department, clientId);
        }
      }

      res.status(201).json(result);
    } catch (err) {
      console.error("Error creating chat group:", err.message);
      res.status(500).json({ error: "Failed to create chat group" });
    }
  }

  /**
   * End/resolve a chat group (mobile client)
   */
  async endChatGroup(req, res) {
    try {
      const { id: chatGroupId } = req.params;
      const clientId = req.userId;
      const feedbackData = req.body || {};

      if (!chatGroupId) {
        return res.status(400).json({ error: "Chat group ID is required" });
      }

      // Convert duration from formatted string to seconds if provided
      if (feedbackData.chatDuration) {
        feedbackData.chatDurationSeconds = this.parseDurationToSeconds(feedbackData.chatDuration);
      }

      const result = await mobileMessageService.endChatGroup(chatGroupId, clientId, feedbackData);

      // Emit socket notification for chat end
      const io = req.app.get('io');
      if (io && io.socketConfig) {
        const notifier = io.socketConfig.getChatGroupNotifier();
        if (notifier) {
          notifier.notifyChatGroupEnded(result, clientId);
        }
      }

      res.json({
        success: true,
        message: "Chat ended successfully",
        data: result
      });
    } catch (err) {
      console.error("❌ Error ending chat group:", err.message);
      res.status(500).json({ error: "Failed to end chat" });
    }
  }

  /**
   * Get resolved chats for current client
   */
  async getResolvedChats(req, res) {
    try {
      const clientId = req.userId;

      const resolvedChats = await mobileMessageService.getResolvedChats(clientId);

      res.json(resolvedChats);
    } catch (err) {
      console.error("❌ Error fetching resolved chats:", err.message);
      res.status(500).json({ error: "Failed to fetch chat history" });
    }
  }

  // Helper method to parse duration string to seconds
  parseDurationToSeconds(durationStr) {
    if (!durationStr || typeof durationStr !== 'string') return null;
    
    let totalSeconds = 0;
    
    // Parse formats like "1h 30m", "45m 20s", "30s"
    const hourMatch = durationStr.match(/(\d+)h/);
    const minuteMatch = durationStr.match(/(\d+)m/);
    const secondMatch = durationStr.match(/(\d+)s/);
    
    if (hourMatch) totalSeconds += parseInt(hourMatch[1]) * 3600;
    if (minuteMatch) totalSeconds += parseInt(minuteMatch[1]) * 60;
    if (secondMatch) totalSeconds += parseInt(secondMatch[1]);
    
    return totalSeconds > 0 ? totalSeconds : null;
  }
}

module.exports = new MobileMessageController();
