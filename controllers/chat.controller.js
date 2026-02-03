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

    // Get room statistics (for monitoring)
    router.get("/admin/room-stats", (req, res) => this.getRoomStats(req, res));

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
          // Include raw timestamp for sorting
          latestMessageTime: latestTime || new Date().toISOString(),
        });

        return acc;
      }, []);

      // Sort by latest message time (newest first) and remove the sorting field
      const sortedFormatted = formatted
        .sort((a, b) => new Date(b.latestMessageTime) - new Date(a.latestMessageTime))
        .map(({ latestMessageTime, ...rest }) => rest);

      res.json(sortedFormatted);
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

      res.json(roomStats);
    } catch (err) {
      console.error("❌ Error getting room stats:", err.message);
      res.status(500).json({ error: "Failed to get room statistics" });
    }
  }
  async handleSendMessage(rawMessage, io, socket) {
    try {
      // Validate message structure - must have either sys_user_id (agent) or client_id (client)
      const isAgent = rawMessage.sys_user_id && !rawMessage.client_id;
      const isClient = rawMessage.client_id && !rawMessage.sys_user_id;
      
      if (!isAgent && !isClient) {
        throw new Error("Message must have either sys_user_id (agent) or client_id (client)");
      }
      
      if (!rawMessage.chat_body || !rawMessage.chat_group_id) {
        throw new Error("chat_body and chat_group_id are required");
      }

      // Prepare message for database insertion
      const message = {
        chat_body: rawMessage.chat_body,
        chat_group_id: rawMessage.chat_group_id,
        chat_created_at: new Date().toISOString(),
        // Set either sys_user_id or client_id based on sender type
        ...(isAgent && { sys_user_id: rawMessage.sys_user_id }),
        ...(isClient && { client_id: rawMessage.client_id })
      };

      // Insert message into database
      const insertedMessage = await chatService.insertMessage(message);

      if (insertedMessage) {
        return insertedMessage;
      }

      throw new Error("Failed to insert message into database");
    } catch (err) {
      console.error("❌ handleSendMessage error:", err.message);
      throw err;
    }
  }
}

module.exports = new ChatController();
