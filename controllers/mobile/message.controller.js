const express = require("express");
const mobileMessageService = require("../../services/mobile/message.service");
const getCurrentMobileUser = require("../../middleware/getCurrentMobileUser");
const { parseDurationToSeconds } = require("../../utils/parseDuration");
const { handleChatAssignment, handleChatQueued, handleChatResolvedByClient } = require("../../socket/customer-list");

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

      res.status(201).json({ data });
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
      const { before, limit } = req.query;
      const clientId = req.userId; // Current client ID from auth middleware

      // Pagination limits for performance (aligned with web API)
      const DEFAULT_LIMIT = 30;
      const MAX_LIMIT = 100;
      const MIN_LIMIT = 10;

      // Parse and validate limit
      const requestedLimit = parseInt(limit) || DEFAULT_LIMIT;
      const safeLimit = Math.max(MIN_LIMIT, Math.min(requestedLimit, MAX_LIMIT));

      const result = await mobileMessageService.getMessagesByGroupId(id, before, safeLimit, clientId);

      // Add pagination metadata for better client-side handling
      const response = {
        messages: result.messages || result,
        pagination: {
          limit: safeLimit,
          hasMore: result.hasMore || false,
          oldestTimestamp: result.oldestTimestamp || null,
          count: result.count || (result.messages || result).length
        }
      };

      res.json({ data: response });
    } catch (err) {
      console.error("❌ Failed to fetch messages:", err.message);
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

      res.status(200).json({ data: chatGroup });
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

      // Emit customerListUpdate to agents
      const io = req.app.get('io');
      if (io) {
        if (result.assigned) {
          await handleChatAssignment(io, result.chat_group_id, result.agent_id);
        } else {
          await handleChatQueued(io, result.chat_group_id, department);
        }
      }

      res.status(201).json({ data: result });
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

      // Validate rating if provided
      if (feedbackData.rating !== undefined && feedbackData.rating !== null) {
        const rating = parseInt(feedbackData.rating);
        if (isNaN(rating) || rating < 0 || rating > 5) {
          return res.status(400).json({ error: "Rating must be between 0 and 5" });
        }
        feedbackData.rating = rating;
      }

      // Convert duration from formatted string to seconds if provided
      if (feedbackData.chatDuration) {
        feedbackData.chatDurationSeconds = parseDurationToSeconds(feedbackData.chatDuration);
        console.log('⏱️ Duration conversion:', {
          original: feedbackData.chatDuration,
          seconds: feedbackData.chatDurationSeconds
        });
      }

      // Validate message count
      if (feedbackData.messageCount !== undefined) {
        feedbackData.messageCount = parseInt(feedbackData.messageCount) || 0;
      }

      const result = await mobileMessageService.endChatGroup(chatGroupId, clientId, feedbackData);

      // Emit socket notification for chat end
      const io = req.app.get('io');
      if (io) {
        // Create system message for the chat end
        // console.log('socket trigger end chat message controller')
        const systemMessage = {
          chat_id: `system_${Date.now()}`,
          chat_body: "Chat ended by customer",
          chat_group_id: chatGroupId,
          chat_created_at: result.resolved_at,
          sys_user_id: null,
          client_id: null,
          sender_type: "system"
        };

        // Broadcast to all users in the chat room
        const eventData = {
          chat_group_id: chatGroupId,
          status: "resolved",
          resolved_at: result.resolved_at,
          resolved_by_type: "client",
          resolved_by_id: clientId,
          system_message: systemMessage,
        };

        io.to(`chat_${chatGroupId}`).emit("chat:resolved", eventData);
        console.log(`📱 Chat ${chatGroupId} ended by mobile client ${clientId}`);

        // Remove chat from agent's customer list
        if (result.agent_id) {
          await handleChatResolvedByClient(io, chatGroupId, result.agent_id);
        }
      }

      res.json({ data: {
        success: true,
        message: "Chat ended successfully",
        result
      } });
    } catch (err) {
      console.error("❌ Error ending chat group:", err.message);
      res.status(500).json({ error: err.message || "Failed to end chat" });
    }
  }

  /**
   * Get resolved chats for current client
   */
  async getResolvedChats(req, res) {
    try {
      const clientId = req.userId;

      const resolvedChats = await mobileMessageService.getResolvedChats(clientId);

      res.json({ data: resolvedChats });
    } catch (err) {
      console.error("❌ Error fetching resolved chats:", err.message);
      res.status(500).json({ error: "Failed to fetch chat history" });
    }
  }

}

module.exports = new MobileMessageController();
