const express = require("express");
const queueService = require("../services/queue.service");
const getCurrentUser = require("../middleware/getCurrentUser");
const { checkPermission } = require("../middleware/checkPermission");
const { PERMISSIONS } = require("../constants/permissions");
const { formatChatGroups } = require("../utils/formatChatGroups");
const { getProfileImages, getLatestMessageTimes } = require("../utils/messageHelpers");

class QueueController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    // Get unassigned chat groups (queue) - requires message viewing permission
    router.get(
      "/chatgroups",
      checkPermission(PERMISSIONS.VIEW_MESSAGE),
      (req, res) => this.getChatGroups(req, res),
    );

    // Accept a chat from the queue - requires message viewing permission
    router.post(
      "/:chatGroupId/accept",
      checkPermission(PERMISSIONS.VIEW_MESSAGE),
      (req, res) => this.acceptChat(req, res),
    );

    // Get chat messages and assign to user - requires message viewing permission
    router.get(
      "/:clientId",
      checkPermission(PERMISSIONS.VIEW_MESSAGE),
      (req, res) => this.getChatMessages(req, res),
    );

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
        return res.json({ data: [] });
      }

      // Extract profile IDs and chat group IDs
      const profIds = groups
        .map((g) => g.client?.prof_id)
        .filter((id) => id !== undefined && id !== null);

      const chatGroupIds = groups.map((g) => g.chat_group_id);

      // Get profile images and latest message times
      const [imageMap, timeMap] = await Promise.all([
        getProfileImages(profIds),
        getLatestMessageTimes(chatGroupIds),
      ]);

      const sortedFormatted = formatChatGroups(groups, imageMap, timeMap);

      res.json({ data: sortedFormatted });
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

      // Emit socket notifications
      const io = req.app.get("io");
      if (io) {
        // Get department ID to broadcast to the right room
        const chatGroupDetails = await queueService.getChatGroupDetails(
          chatGroupId,
        );

        if (chatGroupDetails && chatGroupDetails.dept_id) {
          // 1. Send new_assignment to the agent who accepted (so it appears in their list as active)
          const {
            handleChatAssignment,
          } = require("../socket-simple/customer-list");
          await handleChatAssignment(io, chatGroupId, userId);

          // 2. Emit remove_chat_group to all OTHER agents in the department
          io.to(`department_${chatGroupDetails.dept_id}`).emit(
            "customerListUpdate",
            {
              type: "remove_chat_group",
              data: {
                chat_group_id: chatGroupId,
                accepted_by: userId,
                department_id: chatGroupDetails.dept_id,
              },
            },
          );
        }

        // Legacy notification system (if exists)
        if (io.socketConfig) {
          const notifier = io.socketConfig.getChatGroupNotifier();
          if (notifier && chatGroupDetails) {
            await notifier.notifyChatAccepted(chatGroupDetails, userId);
          }
        }
      }

      res.json({ data: {
        success: true,
        message: "Chat accepted successfully",
        chat_group_id: chatGroup.chat_group_id,
        sys_user_id: chatGroup.sys_user_id,
        status: chatGroup.status,
      } });
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
      const messages = await queueService.getChatMessages(
        clientId,
        groupIdsToFetch,
        before,
        limit,
        userId,
      );

      res.json({ data: { messages } });
    } catch (err) {
      console.error("❌ Error fetching messages:", err);
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new QueueController();
