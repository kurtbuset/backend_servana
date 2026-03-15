const { Server } = require("socket.io");
const chatService = require("../services/chat.service");
const { authenticateSocket } = require("./auth");
const {
  handleConnection,
  setupGlobalErrorHandlers,
  getConnectionStats,
} = require("./connection");
const {
  handleCustomerListUpdate,
  handleChatResolved,
} = require("./customer-list");
const {
  handleAgentOnline,
  handleAgentHeartbeat,
  handleUpdateAgentStatus,
  handleGetAgentStatuses,
  handleAgentDisconnect,
} = require("./agent-status");
const {
  joinDepartmentRooms,
  canJoinRoom,
  handleUserJoined,
  handleUserLeft,
} = require("./room-management");
const SocketManager = require("./manager");

/**
 * Simplified Socket.IO Implementation
 * Main socket server with event handlers
 */

function initializeSocket(server, allowedOrigins) {
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, React Native)
        if (!origin) {
          console.log(
            "✅ Socket.IO: Allowing connection with no origin (mobile app)",
          );
          return callback(null, true);
        }

        console.log(`🔍 Socket.IO: Checking origin: ${origin}`);

        // Allow if origin is in allowed list
        if (allowedOrigins && allowedOrigins.includes(origin)) {
          console.log(`✅ Socket.IO: Origin ${origin} is in allowed list`);
          return callback(null, true);
        }

        // Allow any origin starting with http://192.168 (common home networks)
        if (origin.startsWith("http://192.168")) {
          console.log(`✅ Socket.IO: Allowing 192.168.x.x network: ${origin}`);
          return callback(null, true);
        }

        // Allow any origin starting with http://10. (Android emulator, corporate networks)
        if (origin.startsWith("http://10.")) {
          console.log(`✅ Socket.IO: Allowing 10.x.x.x network: ${origin}`);
          return callback(null, true);
        }

        // Allow any origin starting with http://172. (Docker networks)
        if (origin.startsWith("http://172.")) {
          console.log(`✅ Socket.IO: Allowing 172.x.x.x network: ${origin}`);
          return callback(null, true);
        }

        // In development, allow all origins
        if (
          process.env.NODE_ENV === "development" ||
          process.env.NODE_ENV !== "production"
        ) {
          console.log(
            `✅ Socket.IO: Allowing origin in development mode: ${origin}`,
          );
          return callback(null, true);
        }

        console.error(`❌ Socket.IO: Origin ${origin} not allowed by CORS`);
        return callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
    // Allow all transports for mobile compatibility
    transports: ["websocket", "polling"],
    // Increase ping timeout for mobile networks
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Use simplified auth middleware
  io.use(authenticateSocket);

  // Set up global error handlers
  setupGlobalErrorHandlers(io);

  // Initialize socket manager for periodic tasks
  const socketManager = new SocketManager(io);
  socketManager.start();

  io.on("connection", (socket) => {
    // Handle connection lifecycle
    handleConnection(socket, io);

    // Handle agent coming online and join department rooms
    if (socket.user.userType === "agent") {
      handleAgentOnline(socket, io);
      joinDepartmentRooms(socket);
    }

    // Join chat room
    socket.on("joinChatGroup", async ({ chatGroupId }) => {
      console.log("chatGroupId: ", chatGroupId);
      try {
        if (!chatGroupId) {
          socket.emit("error", { message: "Chat group ID is required" });
          return;
        }

        // Check room access authorization
        const roomAccess = await canJoinRoom(socket.user, chatGroupId);
        if (!roomAccess.allowed) {
          socket.emit("error", {
            message: "Access denied: " + roomAccess.reason,
          });
          return;
        }

        // Leave previous room if in another room
        if (
          socket.currentChatGroup &&
          socket.currentChatGroup !== chatGroupId
        ) {
          socket.leave(`chat_${socket.currentChatGroup}`);
          handleUserLeft(
            io,
            socket,
            `chat_${socket.currentChatGroup}`,
            socket.user.userType,
            socket.user.userId,
            socket.currentChatGroup,
          );
        }

        socket.join(`chat_${chatGroupId}`);
        socket.currentChatGroup = chatGroupId;

        // Notify room that user joined
        handleUserJoined(
          io,
          socket,
          `chat_${chatGroupId}`,
          socket.user.userType,
          socket.user.userId,
          chatGroupId,
        );

        console.log(
          `📱 User ${socket.user.userId} joined chat group ${chatGroupId}`,
        );

        socket.emit("joinedRoom", {
          chatGroupId,
          roomInfo: roomAccess.roomInfo,
        });
      } catch (error) {
        console.error("❌ Error joining chat group:", error);
        socket.emit("error", {
          message: "Failed to join chat group: " + error.message,
        });
      }
    });

    // Leave chat room
    socket.on("leaveChatGroup", ({ chatGroupId }) => {
      if (chatGroupId) {
        socket.leave(`chat_${chatGroupId}`);
        handleUserLeft(
          io,
          socket,
          `chat_${chatGroupId}`,
          socket.user.userType,
          socket.user.userId,
          chatGroupId,
        );
        console.log(
          `👋 User ${socket.user.userId} left chat group ${chatGroupId}`,
        );
      }
    });

    // Leave previous room (explicit)
    socket.on("leavePreviousRoom", () => {
      console.log("leaving previous room");
      if (socket.currentChatGroup) {
        socket.leave(`chat_${socket.currentChatGroup}`);
        handleUserLeft(
          io,
          socket,
          `chat_${socket.currentChatGroup}`,
          socket.user.userType,
          socket.user.userId,
          socket.currentChatGroup,
        );
        socket.currentChatGroup = null;
      }
    });

    // Send message
    socket.on("sendMessage", async (data) => {
      try {
        const { chat_group_id, chat_body } = data;

        if (!chat_group_id || !chat_body) {
          socket.emit("messageError", {
            message: "Chat group ID and message body are required",
          });
          return;
        }

        const messageData = {
          chat_body,
          chat_group_id: chat_group_id,
          chat_created_at: new Date().toISOString(),
          sys_user_id:
            socket.user.userType === "agent" ? socket.user.userId : null,
          client_id:
            socket.user.userType === "client" ? socket.user.userId : null,
        };

        const message = await chatService.insertMessage(messageData);

        // Format message with sender information for broadcasting
        const formattedMessage = {
          ...message,
          sender_type: socket.user.userType === "agent" ? "agent" : "client",
          sender_id: socket.user.userId,
        };

        // Broadcast to all users in the chat room
        io.to(`chat_${chat_group_id}`).emit("receiveMessage", formattedMessage);

        // Send delivery confirmation
        socket.emit("messageDelivered", {
          chat_id: message.chat_id,
          chat_group_id: message.chat_group_id,
          timestamp: message.chat_created_at,
        });

        // Handle customer list update (moves client to top of agent's list)
        await handleCustomerListUpdate(io, message, socket.user.userType);
      } catch (error) {
        console.error("❌ Error sending message:", error);
        socket.emit("messageError", { message: "Failed to send message" });
      }
    });

    // End chat (resolve)
    socket.on("resolveChat", async ({ chatGroupId }) => {
      try {
        if (!chatGroupId) {
          socket.emit("error", { message: "Chat group ID is required" });
          return;
        }

        // Only agents can resolve chats for now (can be extended later)
        if (socket.user.userType !== "agent") {
          socket.emit("error", { message: "Only agents can resolve chats" });
          return;
        }

        // Resolve the chat group
        await chatService.resolveChatGroup(chatGroupId, socket.user.userId);

        // Create system message
        const systemMessage = await chatService.insertMessage({
          chat_body: `Chat ended by ${socket.user.userType}`,
          chat_group_id: chatGroupId,
          chat_created_at: new Date().toISOString(),
          sys_user_id: null, // System message
          client_id: null, // System message
        });

        // Broadcast to all users in the chat room
        const eventData = {
          chat_group_id: chatGroupId,
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by_type: socket.user.userType,
          resolved_by_id: socket.user.userId,
          system_message: systemMessage,
        };

        io.to(`chat_${chatGroupId}`).emit("chatResolved", eventData);

        // Handle customer list update (remove from active chats)
        handleChatResolved(io, chatGroupId, null); // TODO: Get department ID

        console.log(
          `✅ Chat ${chatGroupId} resolved by ${socket.user.userType} ${socket.user.userId}`,
        );
      } catch (error) {
        console.error("❌ Error resolving chat:", error);
        socket.emit("error", {
          message: "Failed to resolve chat: " + error.message,
        });
      }
    });

    // Typing indicators
    socket.on("typing", ({ chatGroupId, userName }) => {
      console.log(
        `👤 ${userName || socket.user.userType} typing in ${chatGroupId}`,
      );
      if (chatGroupId) {
        socket.to(`chat_${chatGroupId}`).emit("typing", {
          chatGroupId,
          userId: socket.user.userId,
          userType: socket.user.userType,
          userName: userName || socket.user.userType,
        });
      }
    });

    socket.on("stopTyping", ({ chatGroupId }) => {
      console.log(`👤 User stopped typing in ${chatGroupId}`);
      if (chatGroupId) {
        socket.to(`chat_${chatGroupId}`).emit("stopTyping", {
          chatGroupId,
          userId: socket.user.userId,
          userType: socket.user.userType,
        });
      }
    });

    // Agent status events
    socket.on("agentOnline", async () => {
      await handleAgentOnline(socket, io);
    });

    socket.on("agentHeartbeat", async () => {
      await handleAgentHeartbeat(socket);
    });

    socket.on("updateAgentStatus", async (data) => {
      await handleUpdateAgentStatus(socket, io, data);
    });

    socket.on("getAgentStatuses", async () => {
      await handleGetAgentStatuses(socket);
    });

    socket.on("agentOffline", async () => {
      await handleAgentDisconnect(socket, io);
    });
  });

  console.log("🔌 Simplified Socket.IO server initialized");

  // Add utility functions to io instance
  io.getStats = () => getConnectionStats(io);
  io.manager = socketManager;

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("🛑 Shutting down socket manager...");
    socketManager.stop();
  });

  return io;
}

module.exports = { initializeSocket };
