const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser'); // ✅ Required for HTTP-only cookies
require('dotenv').config();

const departmentRoutes = require('./routes/department');   
const adminsRoutes = require('./routes/manageAdmin');
const autoReplies = require('./routes/autoReplies');
const macrosAgentsRoutes = require("./routes/macrosAgents");
const macrosClientsRoutes = require("./routes/macrosClients");
const changeRoleRoutes = require("./routes/changeRole");
const chatModule = require('./routes/chat');
const chatRoutes = chatModule.router; // for routing
const { handleSendMessage } = chatModule; // for socket
const queues = require("./routes/queues");
const roleRoutes = require("./routes/role");
const manageAgentsRoutes = require('./routes/manageAgents');
const authRoutes = require('./routes/auth'); // ✅ Add Auth Routes
const profileRoutes = require("./routes/profile");
const clientAccountRoutes = require("./routes/mobile/clientAccount");
const routesDepartments = require("./routes/mobile/departments");
const messagesRoutes = require("./routes/mobile/messages");

const app = express();
const http = require('http');
const socketIo = require('socket.io');
const port = process.env.PORT || 3000;

// ✅ Middleware
app.use(express.static("public"));

const allowedOrigins = [
  'http://localhost:5173', // React web
  'http://localhost:8081', // React Native Expo (optional)
  // 'http://192.168.1.100:19006'
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true // ✅ Important for sending cookies
}));

app.use(express.json());
app.use(cookieParser()); // ✅ Required for reading cookies

// ✅ Auth Routes
app.use('/auth', authRoutes); // ✅ Supabase + system_user auth

// ✅ Your Existing Routes

app.use("/profile", profileRoutes);
app.use('/departments', departmentRoutes);
app.use('/admins', adminsRoutes);
app.use('/auto-replies', autoReplies);
app.use("/agents", macrosAgentsRoutes);
app.use("/clients", macrosClientsRoutes);
app.use("/change-role", changeRoleRoutes);
app.use("/chat", chatRoutes);
app.use("/queues", queues);
app.use("/roles", roleRoutes);
app.use('/manage-agents', manageAgentsRoutes);
app.use('/clientAccount', clientAccountRoutes); // ✅ Mobile client account
app.use('/department', routesDepartments); // ✅ Mobile departments
app.use('/messages', messagesRoutes); // ✅ Mobile messages


// ✅ Socket.IO Setup
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: 'http://localhost:5173', 
    credentials: true,
  }
});

// Helper function to broadcast chat count updates
async function broadcastChatCounts(io) {
  try {
    const supabase = require('./helpers/supabaseClient');
    
    // Get pending chats count (not assigned to any agent)
    const { count: pendingCount } = await supabase
      .from("chat_group")
      .select("chat_group_id", { count: "exact", head: true })
      .is("sys_user_id", null);

    // Get active chats count (assigned to agents via junction table)
    const { count: activeCount } = await supabase
      .from("sys_user_chat_group")
      .select("id", { count: "exact", head: true });

    // Broadcast to all connected clients
    io.emit("chatCountsUpdate", {
      pendingChats: pendingCount || 0,
      activeChats: activeCount || 0
    });
    
    console.log(`📊 Broadcasted counts - Pending: ${pendingCount}, Active: ${activeCount}`);
  } catch (error) {
    console.error("Error broadcasting chat counts:", error);
  }
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  socket.on('joinChatGroup', (groupId) => {
    socket.join(groupId);
    console.log(`Socket ${socket.id} joined chat_group ${groupId}`);
  });

  socket.on('sendMessage', async (message) => {
    await handleSendMessage(message, io, socket);
  });

  // When agent accepts a chat from queue
  socket.on('acceptChat', async (data) => {
    try {
      // Update chat_group with agent assignment
      // ... your logic here ...
      
      // Broadcast updated counts
      await broadcastChatCounts(io);
      io.emit('chatAccepted', { chatGroupId: data.chatGroupId });
    } catch (error) {
      console.error("Error accepting chat:", error);
    }
  });

  // When a chat is closed/resolved
  socket.on('closeChat', async (data) => {
    try {
      // Update chat_group status
      // ... your logic here ...
      
      // Broadcast updated counts
      await broadcastChatCounts(io);
      io.emit('chatClosed', { chatGroupId: data.chatGroupId });
    } catch (error) {
      console.error("Error closing chat:", error);
    }
  });

  // When messages are marked as seen/read
  socket.on('markMessagesSeen', async (data) => {
    try {
      // Mark messages as read in database
      // ... your logic here ...
      
      // Notify that messages were seen
      io.emit('messagesSeen', { chatGroupId: data.chatGroupId });
      
      // Optionally broadcast updated counts if this affects unread counts
      await broadcastChatCounts(io);
    } catch (error) {
      console.error("Error marking messages as seen:", error);
    }
  });

  // When a new chat is created (from client)
  socket.on('newChat', async (data) => {
    try {
      // Create new chat_group
      // ... your logic here ...
      
      // Broadcast to all agents that there's a new chat in queue
      io.emit('newChatInQueue', { chatGroupId: data.chatGroupId });
      await broadcastChatCounts(io);
    } catch (error) {
      console.error("Error creating new chat:", error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Export io and broadcastChatCounts for use in routes
module.exports.io = io;
module.exports.broadcastChatCounts = broadcastChatCounts;

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
