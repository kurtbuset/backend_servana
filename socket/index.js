const { Server } = require("socket.io");
const chatService = require("../services/chat.service");
const { authenticateSocket } = require("./auth");
const {
  handleConnection,
  setupGlobalErrorHandlers,
  getConnectionStats,
} = require("./connection");
const {
  canJoinRoom,
  handleUserJoined,
  handleUserLeft,
} = require("./room-management");
const SocketManager = require("./manager");
const {
  getChatGroupInfo,
  getClientInfo,
} = require("./customer-list");

/**
 * Simplified Socket.IO Implementation
 * Main socket server with event handlers
 */

// Per-user rate limiting for socket events (in-memory)
const socketRateLimits = new Map(); // userId -> { messages: [], lastTyping: 0 }

function checkMessageRateLimit(userId) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxMessages = 30;

  if (!socketRateLimits.has(userId)) {
    socketRateLimits.set(userId, { messages: [], lastTyping: 0 });
  }

  const userLimits = socketRateLimits.get(userId);
  // Remove timestamps older than the window
  userLimits.messages = userLimits.messages.filter(ts => now - ts < windowMs);

  if (userLimits.messages.length >= maxMessages) {
    return false; // Rate limit exceeded
  }

  userLimits.messages.push(now);
  return true;
}

function checkTypingRateLimit(userId) {
  const now = Date.now();
  const minIntervalMs = 1000; // max 1 typing event per second

  if (!socketRateLimits.has(userId)) {
    socketRateLimits.set(userId, { messages: [], lastTyping: 0 });
  }

  const userLimits = socketRateLimits.get(userId);
  if (now - userLimits.lastTyping < minIntervalMs) {
    return false; // Rate limit exceeded
  }

  userLimits.lastTyping = now;
  return true;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const windowMs = 60 * 1000;
  for (const [userId, limits] of socketRateLimits.entries()) {
    limits.messages = limits.messages.filter(ts => now - ts < windowMs);
    const isStale = limits.messages.length === 0 && (now - limits.lastTyping > 5 * 60 * 1000);
    if (isStale) socketRateLimits.delete(userId);
  }
}, 5 * 60 * 1000);

function initializeSocket(server, allowedOrigins) {
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, React Native)
        if (!origin) {
          console.log("✅ Socket.IO: Allowing connection with no origin (mobile app)");
          return callback(null, true);
        }

        console.log(`🔍 Socket.IO: Checking origin: ${origin}`);

        // Normalize origin by removing port if it's default (80 for http, 443 for https)
        const normalizedOrigin = origin.replace(/:443$/, '').replace(/:80$/, '');
        const normalizedAllowedOrigins = allowedOrigins.map(o => 
          o ? o.replace(/:443$/, '').replace(/:80$/, '') : o
        );

        // Allow if origin matches (with or without port)
        if (allowedOrigins && allowedOrigins.includes(origin)) {
          console.log(`✅ Socket.IO: Origin ${origin} is in allowed list`);
          return callback(null, true);
        }

        // Check normalized origins
        if (normalizedAllowedOrigins.includes(normalizedOrigin)) {
          console.log(`✅ Socket.IO: Normalized origin ${normalizedOrigin} is in allowed list`);
          return callback(null, true);
        }

        // Allow same-origin requests (backend connecting to itself)
        if (normalizedOrigin === 'https://backend-servana.onrender.com') {
          console.log(`✅ Socket.IO: Allowing same-origin request: ${origin}`);
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

        // Allow mobile app schemes
        if (origin.startsWith("capacitor://") || origin.startsWith("ionic://")) {
          console.log(`✅ Socket.IO: Allowing mobile app origin: ${origin}`);
          return callback(null, true);
        }

        // In development, allow all origins
        if (
          process.env.NODE_ENV === "development" ||
          process.env.NODE_ENV !== "production"
        ) {
          console.log(`✅ Socket.IO: Allowing origin in development mode: ${origin}`);
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
    // Allow upgrades from polling to websocket
    allowUpgrades: true,
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

    // Join chat room
    socket.on("chat:join", async ({ chatGroupId }) => {
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
          
          // Log room leave with stats
          const previousRoomSize = io.sockets.adapter.rooms.get(previousRoom)?.size || 0;
          const totalRooms = io.sockets.adapter.rooms.size;
          // console.log(`🚪 ${socket.user.userType} ${socket.user.userId} left room: ${previousRoom} | Users in room: ${previousRoomSize} | Total rooms: ${totalRooms}`);
          
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

        // Notify room that user joined and auto-mark messages as read
        await handleUserJoined(
          io,
          socket,
          `chat_${chatGroupId}`,
          socket.user.userType,
          socket.user.userId,
          chatGroupId,
        );

        // Log room join with stats
        const currentRoomSize = io.sockets.adapter.rooms.get(`chat_${chatGroupId}`)?.size || 0;
        const totalRooms = io.sockets.adapter.rooms.size;
        const totalConnections = io.sockets.sockets.size;
        console.log(`📱 ${socket.user.userType} ${socket.user.userId} joined room: chat_${chatGroupId} | Users in room: ${currentRoomSize} | Total rooms: ${totalRooms} | Total connections: ${totalConnections}`);
      } catch (error) {
        console.error("❌ Error joining chat group:", error);
        socket.emit("error", {
          message: "Failed to join chat group: " + error.message,
        });
      }
    });

    // Send message
    socket.on("sendMessage", async (data) => {
      const userId = socket.user?.userId;
      if (userId && !checkMessageRateLimit(userId)) {
        socket.emit('error', { message: 'Message rate limit exceeded. Max 30 messages per minute.' });
        return;
      }
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

        // Emit customerListUpdate to move chat to top of list
        const chatGroupInfo = await getChatGroupInfo(chat_group_id);
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

      } catch (error) {
        console.error("❌ Error sending message:", error);
        socket.emit("messageError", { message: "Failed to send message" });
      }
    });

    // Leave chat room
    socket.on("chat:leave", async ({ chatGroupId }) => {
      try {
        if (!chatGroupId) {
          socket.emit("error", { message: "Chat group ID is required" });
          return;
        }

        const roomName = `chat_${chatGroupId}`;
        
        // Check if user is actually in this room
        // if (socket.currentChatGroup !== chatGroupId) {
        //   socket.emit("error", { message: "You are not in this chat room" });
        //   return;
        // }

        // Leave the room
        socket.leave(roomName);
        
        // Log room leave with stats
        const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
        const totalRooms = io.sockets.adapter.rooms.size;
        const totalConnections = io.sockets.sockets.size;
        console.log(`Users in room: ${roomSize} | Total rooms: ${totalRooms} | Total connections: ${totalConnections}`);
        
        // Notify others in the room
        handleUserLeft(
          io,
          socket,
          roomName,
          socket.user.userType,
          socket.user.userId,
          chatGroupId,
        );

        // Clear current chat group
        socket.currentChatGroup = null;

        // Confirm to the user
        socket.emit("chat:left", { chatGroupId });

      } catch (error) {
        console.error("❌ Error leaving chat group:", error);
        socket.emit("error", {
          message: "Failed to leave chat group: " + error.message,
        });
      }
    });

    // Typing indicators
    socket.on("typing", ({ chatGroupId, userName }) => {
      const userId = socket.user?.userId;
      if (userId && !checkTypingRateLimit(userId)) {
        return; // Silently drop excessive typing events
      }
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
  });

  console.log("Socket.IO server initialized");

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
