const express = require("express");
const queueService = require("../services/queue.service");
const getCurrentUser = require("../middleware/getCurrentUser");

class QueueController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    // Get unassigned chat groups (queue)
    router.get("/chatgroups", (req, res) => this.getChatGroups(req, res));

    // Accept a chat from the queue
    router.post("/:chatGroupId/accept", (req, res) => this.acceptChat(req, res));

    // Get chat messages and assign to user
    router.get("/:clientId", (req, res) => this.getChatMessages(req, res));


    return router;
  }
  /**
   * Get unassigned chat groups (queue)
   */
  async getChatGroups(req, res) {
    try {
      const userId = req.userId;
      const groups = await queueService.getUnassignedChatGroups(userId);

      if (!groups || groups.length === 0) {
        return res.json([]);
      }

      // Extract profile IDs and chat group IDs
      const profIds = groups
        .map((g) => g.client?.prof_id)
        .filter((id) => id !== undefined && id !== null);

      const chatGroupIds = groups.map((g) => g.chat_group_id);

      // Get profile images and latest message times
      const [imageMap, timeMap] = await Promise.all([
        queueService.getProfileImages(profIds),
        queueService.getLatestMessageTimes(chatGroupIds),
      ]);

      // Format response
      const formatted = groups.map((group) => {
        const client = group.client;
        if (!client) return null;

        const fullName = client.profile
          ? `${client.profile.prof_firstname} ${client.profile.prof_lastname}`
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

        return {
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
            status: group.status, // Include the actual status (queued or transferred)
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
   * Accept a chat from the queue
   */
  async acceptChat(req, res) {
    try {
      const { chatGroupId } = req.params;
      const userId = req.userId;

      if (!chatGroupId) {
        return res.status(400).json({ error: "Chat group ID is required" });
      }

      const chatGroup = await queueService.acceptChat(chatGroupId, userId);

      res.json({
        success: true,
        message: "Chat accepted successfully",
        data: {
          chat_group_id: chatGroup.chat_group_id,
          sys_user_id: chatGroup.sys_user_id,
          status: chatGroup.status
        }
      });
    } catch (err) {
      console.error("❌ Error accepting chat:", err);
      
      if (err.message === "Chat group not found or already assigned") {
        return res.status(404).json({ error: err.message });
      }
      
      res.status(500).json({ error: "Failed to accept chat" });
    }
  }

  /**
   * Get chat messages and assign to user if needed
   */
  async getChatMessages(req, res) {
    try {
      const { clientId } = req.params;
      const { before, limit = 10 } = req.query;
      const userId = req.userId;

      // Fetch all chat groups for this client
      const groups = await queueService.getChatGroupsByClient(clientId);

      if (!groups || groups.length === 0) {
        return res.status(404).json({ error: "Chat group not found" });
      }

      const groupIdsToFetch = [];

      // Process each group
      for (const group of groups) {
        const { chat_group_id, sys_user_id } = group;

        // if (sys_user_id === null) {
        //   // Update chat_group.sys_user_id to current user
        //   await queueService.assignChatGroupToUser(chat_group_id, userId);

        //   // Check if sys_user_chat_group already exists
        //   const existingLink = await queueService.checkUserChatGroupLink(userId, chat_group_id);

        //   // Insert new sys_user_chat_group link if not exists
        //   if (!existingLink) {
        //     await queueService.createUserChatGroupLink(userId, chat_group_id);
        //   }

        //   groupIdsToFetch.push(chat_group_id);
        // } else {
        //   // Still add to groupIdsToFetch if user already linked
        //   const existingLink = await queueService.checkUserChatGroupLink(userId, chat_group_id);

        //   if (existingLink) {
            groupIdsToFetch.push(chat_group_id);
          // }
        // }
      }

      // Fetch chats
      const messages = await queueService.getChatMessages(clientId, groupIdsToFetch, before, limit, userId);

      res.json({ messages });
    } catch (err) {
      console.error("❌ Error fetching messages:", err);
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new QueueController();
