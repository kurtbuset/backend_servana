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
  handleAgentExplicitOffline,
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
            // "✅ Socket.IO: Allowing connection with no origin (mobile app)",
          );
          return callback(null, true);
        }

        // console.log(`🔍 Socket.IO: Checking origin: ${origin}`);

        // Allow if origin is in allowed list
        if (allowedOrigins && allowedOrigins.includes(origin)) {
          // console.log(`✅ Socket.IO: Origin ${origin} is in allowed list`);
          return callback(null, true);
        }

        // Allow any origin starting with http://192.168 (common home networks)
        if (origin.startsWith("http://192.168")) {
          // console.log(`✅ Socket.IO: Allowing 192.168.x.x network: ${origin}`);
          return callback(null, true);
        }

        // Allow any origin starting with http://10. (Android emulator, corporate networks)
        if (origin.startsWith("http://10.")) {
          // console.log(`✅ Socket.IO: Allowing 10.x.x.x network: ${origin}`);
          return callback(null, true);
        }

        // Allow any origin starting with http://172. (Docker networks)
        if (origin.startsWith("http://172.")) {
          // console.log(`✅ Socket.IO: Allowing 172.x.x.x network: ${origin}`);
          return callback(null, true);
        }

        // In development, allow all origins
        if (
          process.env.NODE_ENV === "development" ||
          process.env.NODE_ENV !== "production"
        ) {
          console.log(
            // `✅ Socket.IO: Allowing origin in development mode: ${origin}`,
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
          const previousRoom = `chat_${socket.currentChatGroup}`;
          socket.leave(previousRoom);
          
          // Log room leave
          const previousRoomSize = io.sockets.adapter.rooms.get(previousRoom)?.size || 0;
          console.log(`🚪 ${socket.user.userType} ${socket.user.userId} left room: ${previousRoom} (${previousRoomSize} users remaining)`);
          
          handleUserLeft(
            io,
            socket,
            previousRoom,
            socket.user.userType,
            socket.user.userId,
            socket.currentChatGroup,
          );
        }

        socket.join(`chat_${chatGroupId}`);
        socket.currentChatGroup = chatGroupId;

        // Log room join with detailed info
        // const roomName = `chat_${chatGroupId}`;
        // const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
        // console.log(`🏠 ${socket.user.userType} ${socket.user.userId} joined room: ${roomName} (${roomSize} users total)`);
        
        // // Log all current rooms for this socket
        // const userRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
        // console.log(`📍 Socket ${socket.id} is now in rooms: [${userRooms.join(', ')}]`);
        
        // // Log room members if room size is small (for debugging)
        // if (roomSize <= 5) {
        //   const roomSockets = io.sockets.adapter.rooms.get(roomName);
        //   if (roomSockets) {
        //     const memberIds = Array.from(roomSockets);
        //     console.log(`👥 Room ${roomName} members: [${memberIds.join(', ')}]`);
        //   }
        // }

        // Notify room that user joined and auto-mark messages as read
        await handleUserJoined(
          io,
          socket,
          `chat_${chatGroupId}`,
          socket.user.userType,
          socket.user.userId,
          chatGroupId,
        );

        console.log(`📱 ${socket.user.userType} ${socket.user.userId} joining chat group ${chatGroupId}`);
      } catch (error) {
        console.error("❌ Error joining chat group:", error);
        socket.emit("error", {
          message: "Failed to join chat group: " + error.message,
        });
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

        // Auto-update message status based on recipient presence
        const supabase = require("../helpers/supabaseClient");
        const timestamp = new Date().toISOString();
        
        // Always mark as delivered immediately
        await supabase
          .from("chat") 
          .update({ chat_delivered_at: timestamp })
          .eq("chat_id", message.chat_id);

        console.log(`📬 Message ${message.chat_id} auto-marked as delivered`);

        // Check if recipient is currently in the chat room
        const socketsInRoom = await io.in(`chat_${chat_group_id}`).fetchSockets();
        const senderType = socket.user.userType;

        let recipientIsActive = false;

        console.log(`senderType: ${senderType}`)
        
        if (senderType === "agent") {
          // Agent sent message - check if any client is in room
          recipientIsActive = socketsInRoom.some(s => s.user.userType === "client");
        } else if (senderType === "client") {
          // Client sent message - check if any agent is in room
          recipientIsActive = socketsInRoom.some(s => 
            s.user.userType === "agent" || s.user.userType === "admin"
          );
        }

        console.log('recipientIsActive: ', recipientIsActive)
        if (recipientIsActive) {
          // Recipient is active - also mark as read
          await supabase
            .from("chat")
            .update({ chat_read_at: timestamp })
            .eq("chat_id", message.chat_id);

          console.log(`👁️ Message ${message.chat_id} auto-marked as read (recipient active)`);

          // Broadcast read status
          io.to(`chat_${chat_group_id}`).emit("messageStatusUpdate", {
            chatId: message.chat_id,
            status: "read",
            timestamp,
            updatedBy: "system",
            updatedByType: "auto"
          });
        } else {
          // Recipient not active - just broadcast delivered status
          io.to(`chat_${chat_group_id}`).emit("messageStatusUpdate", {
            chatId: message.chat_id,
            status: "delivered",
            timestamp,
            updatedBy: "system",
            updatedByType: "auto"
          });
        }

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
      await handleAgentExplicitOffline(socket, io);
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
