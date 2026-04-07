const express = require("express");
const chatService = require("../services/chat.service");
const getCurrentUser = require("../middleware/getCurrentUser");
const { checkPermission } = require("../middleware/checkPermission");
const { PERMISSIONS } = require("../constants/permissions");
const { formatChatGroups } = require("../utils/formatChatGroups");
const { getProfileImages, getLatestMessageTimes } = require("../utils/messageHelpers");
const { CHAT_STATUS } = require("../constants/statuses");
const { parseDurationToSeconds } = require("../utils/parseDuration");
const { getChatGroupInfo, getClientInfo } = require("../socket/customer-list");

class ChatController {
  getRouter() {
    const router = express.Router();

    router.use(getCurrentUser);

    // Get canned messages for current user's role - requires canned message permission
    router.get("/canned-messages", 
      checkPermission(PERMISSIONS.USE_CANNED_MESS),
      (req, res) => this.getCannedMessages(req, res)
    );

    // Get all chat groups for current user - requires message viewing permission
    router.get("/chatgroups", 
      checkPermission(PERMISSIONS.VIEW_MESSAGE),
      (req, res) => this.getChatGroups(req, res)
    );

    // Get resolved chat groups for current user - requires message viewing permission
    router.get("/resolved-chatgroups", 
      checkPermission(PERMISSIONS.VIEW_MESSAGE),
      (req, res) => this.getResolvedChatGroups(req, res)
    );

    // Transfer chat group to another department - requires message viewing permission
    router.post("/:chatGroupId/transfer", 
      checkPermission(PERMISSIONS.CAN_TRANSFER),
      (req, res) => this.transferChatGroup(req, res)
    );

    // Resolve chat group (mark as resolved) - requires end chat permission
    router.patch("/:chatGroupId/resolve", 
      checkPermission(PERMISSIONS.END_CHAT),
      (req, res) => this.resolveChatGroup(req, res)
    );

    // Get room statistics (for monitoring) - protected by getCurrentUser middleware above
    router.get("/admin/room-stats", (req, res) => this.getRoomStats(req, res));

    // Get chat messages for a specific client - requires message viewing permission
    router.get("/:clientId",
      checkPermission(PERMISSIONS.VIEW_MESSAGE),
      (req, res) => this.getChatMessages(req, res)
    );

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
      const messages = await chatService.getCannedMessagesByRole(roleId, userId);

      res.json({ data: messages });
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
        return res.json({ data: [] });
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
        profIds.length > 0 ? getProfileImages(profIds) : Promise.resolve({}),
        getLatestMessageTimes(chatGroupIds),
      ]);

      const sortedFormatted = formatChatGroups(groups, imageMap, timeMap, {
        status: CHAT_STATUS.ACTIVE,
        sysUserId: userId,
        isAccepted: true,
      });

      res.json({ data: sortedFormatted });
    } catch (err) {
      console.error("❌ Error fetching chat groups:", err);
      res.status(500).json({ error: "Failed to fetch chat groups" });
    }
  }

  /**
   * Get resolved chat groups for the current user - Optimized
   */
  async getResolvedChatGroups(req, res) {
    try {
      const { userId } = req;

      const groups = await chatService.getResolvedChatGroupsByUser(userId);

      if (!groups || groups.length === 0) {
        return res.json({ data: [] });
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
        profIds.length > 0 ? getProfileImages(profIds) : Promise.resolve({}),
        getLatestMessageTimes(chatGroupIds),
      ]);

      const sortedFormatted = formatChatGroups(groups, imageMap, timeMap, {
        status: CHAT_STATUS.RESOLVED,
        sysUserId: userId,
        isAccepted: true,
      });

      res.json({ data: sortedFormatted });
    } catch (err) {
      console.error("❌ Error fetching resolved chat groups:", err);
      res.status(500).json({ error: "Failed to fetch resolved chat groups" });
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

      const result = await chatService.transferChatGroup(chatGroupId, deptId, userId);

      // Emit socket event for real-time updates
      const io = req.app.get('io');
      if (io) {
        // Get transfer details from service (department names, agent name)
        const details = await chatService.getTransferDetails(
          result.from_dept_id, deptId, result.assignmentResult
        );

        // Emit transfer message to chat room
        io.to(`chat_${chatGroupId}`).emit('chatTransferred', {
          chat_group_id: chatGroupId,
          transfer_type: 'manual',
          from_dept: details.fromDeptName,
          to_dept: details.toDeptName,
          to_agent: details.toAgentName,
          assigned: result.assignmentResult.assigned,
          timestamp: new Date().toISOString()
        });

        // Emit customerListUpdate to move chat to top of list for assigned agent
        const chatGroupInfo = await getChatGroupInfo(chatGroupId);
        if (chatGroupInfo && chatGroupInfo.sys_user_id) {
          const clientInfo = await getClientInfo(chatGroupInfo.client_id);
          if (clientInfo) {
            const moveToTopPayload = {
              type: 'move_to_top',
              data: {
                customer: {
                  chat_group_id: chatGroupInfo.chat_group_id,
                  name: clientInfo.name,
                  number: clientInfo.client_number,
                  profile: clientInfo.profile_image,
                  status: chatGroupInfo.status,
                  department: chatGroupInfo.department?.dept_name || "Unknown",
                  sys_user_id: chatGroupInfo.sys_user_id,
                  dept_id: chatGroupInfo.dept_id,
                },
              },
              timestamp: new Date().toISOString(),
            };

            // Emit only to the assigned agent
            const agentRoom = `agent_${chatGroupInfo.sys_user_id}`;
            io.to(agentRoom).emit('customerListUpdate', moveToTopPayload);
          }
        }
      }

      res.json({ data: {
        success: true,
        message: result.assignmentResult.assigned
          ? `Chat transferred and assigned to agent ${result.assignmentResult.agentId}`
          : "Chat transferred and queued (no available agents)",
        chat_group_id: result.chat_group_id,
        dept_id: result.dept_id,
        status: result.status,
        sys_user_id: result.sys_user_id,
        assigned: result.assignmentResult.assigned,
        assigned_agent_id: result.assignmentResult.agentId || null,
      }});
    } catch (err) {
      console.error("❌ Error transferring chat:", err);

      if (err.message === "Chat group not found or you don't have permission to transfer it") {
        return res.status(404).json({ error: err.message });
      }

      res.status(500).json({ error: "Failed to transfer chat" });
    }
  }

  /**
   * Resolve chat group (mark as resolved)
   */
  async resolveChatGroup(req, res) {
    try {
      const { chatGroupId } = req.params;
      const { userId } = req;
      const feedbackData = req.body || {};

      if (!chatGroupId) {
        return res.status(400).json({
          error: "Chat group ID is required"
        });
      }

      // Convert duration from formatted string to seconds if provided
      if (feedbackData.chatDuration) {
        feedbackData.chatDurationSeconds = parseDurationToSeconds(feedbackData.chatDuration);
      }

      const resolvedChat = await chatService.resolveChatGroup(chatGroupId, userId, feedbackData);

      // Emit socket notification for chat resolution
      const io = req.app.get('io');
      if (io) {
        // Create system message for the chat resolution
        const systemMessage = {
          chat_id: `system_${Date.now()}`,
          chat_body: "Chat ended by agent",
          chat_group_id: chatGroupId,
          chat_created_at: resolvedChat.resolved_at,
          sys_user_id: null,
          client_id: null,
          sender_type: "system"
        };

        // Broadcast to all users in the chat room
        const eventData = {
          chat_group_id: chatGroupId,
          status: "resolved",
          resolved_at: resolvedChat.resolved_at,
          resolved_by_type: "agent",
          resolved_by_id: userId,
          system_message: systemMessage,
        };

        io.to(`chat_${chatGroupId}`).emit("chat:resolved", eventData);
        // console.log(`💻 Chat ${chatGroupId} resolved by agent ${userId}`);
      }

      res.json({ data: {
        success: true,
        message: "Chat resolved successfully",
        chat_group_id: resolvedChat.chat_group_id,
        status: resolvedChat.status,
        resolved_at: resolvedChat.resolved_at,
        feedback: resolvedChat.feedback
      } });
    } catch (err) {
      console.error("❌ Error resolving chat:", err.message);
      res.status(500).json({ error: "Failed to resolve chat" });
    }
  }

  /**
   * Get chat messages for a specific client
   */
  async getChatMessages(req, res) {
    try {
      const { clientId } = req.params;
      const { before, limit } = req.query;
      const { userId } = req;

      // Pagination limits for performance
      const DEFAULT_LIMIT = 30;
      const MAX_LIMIT = 100;
      const MIN_LIMIT = 10;

      // Parse and validate limit
      const requestedLimit = parseInt(limit) || DEFAULT_LIMIT;
      const safeLimit = Math.max(MIN_LIMIT, Math.min(requestedLimit, MAX_LIMIT));

      const result = await chatService.getChatMessages(clientId, before, safeLimit, userId);

      // Add pagination metadata
      const response = {
        messages: result.messages,
        pagination: {
          limit: safeLimit,
          hasMore: result.messages.length === safeLimit,
          oldestTimestamp: result.messages.length > 0 ? result.messages[0]?.chat_created_at : null,
          count: result.messages.length
        }
      };

      res.json({ data: response });
    } catch (err) {
      console.error("❌ Error fetching chat messages:", err);

      if (err.message === "Chat group not found") {
        return res.status(404).json({ error: err.message });
      }

      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get room statistics for monitoring
   */
  getRoomStats(req, res) {
    try {
      // Access the io instance (you'll need to pass it to the controller)
      const io = req.app.get('io');
      const rooms = io.sockets.adapter.rooms;
      
      const roomStats = {
        totalRooms: rooms.size,
        activeRooms: [],
        totalConnectedUsers: io.sockets.sockets.size,
        timestamp: new Date().toISOString()
      };

      rooms.forEach((sockets, roomName) => {
        // Skip default socket rooms (socket IDs)
        if (!sockets.has(roomName)) {
          const roomUsers = [];
          sockets.forEach(socketId => {
            const roomSocket = io.sockets.sockets.get(socketId);
            if (roomSocket && roomSocket.userType) {
              roomUsers.push({
                socketId: socketId,
                userType: roomSocket.userType,
                userId: roomSocket.userId
              });
            }
          });

          roomStats.activeRooms.push({
            roomName: roomName,
            userCount: sockets.size,
            users: roomUsers,
            hasAgent: roomUsers.some(u => u.userType === 'agent'),
            hasClient: roomUsers.some(u => u.userType === 'client'),
            isRealTime: roomUsers.some(u => u.userType === 'agent') && roomUsers.some(u => u.userType === 'client')
          });
        }
      });

      // Sort rooms by user count (most active first)
      roomStats.activeRooms.sort((a, b) => b.userCount - a.userCount);

      res.json({ data: roomStats });
    } catch (err) {
      console.error("❌ Error getting room stats:", err.message);
      res.status(500).json({ error: "Failed to get room statistics" });
    }
  }
}

module.exports = new ChatController();
