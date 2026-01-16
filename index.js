const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser'); // ✅ Required for HTTP-only cookies
require('dotenv').config();

const departmentController = require('./controllers/department.controller');   
const adminController = require('./controllers/admin.controller');
const autoReplyController = require('./controllers/autoReply.controller');
const macroController = require("./controllers/macro.controller");
const changeRoleController = require("./controllers/changeRole.controller");
const chatController = require('./controllers/chat.controller');
const queueController = require("./controllers/queue.controller");
const roleController = require("./controllers/role.controller");
const agentController = require('./controllers/agent.controller');
const authController = require('./controllers/auth.controller');
const profileController = require("./controllers/profile.controller");
const clientAccountController = require("./controllers/mobile/clientAccount.controller");
const mobileDepartmentController = require("./controllers/mobile/department.controller");
const mobileMessageController = require("./controllers/mobile/message.controller");

const AGENT_ROLE_ID = 3;
const CLIENT_ROLE_ID = 2;

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
app.use('/auth', authController.getRouter()); // ✅ Supabase + system_user auth

// ✅ Your Existing Routes

app.use("/profile", profileController.getRouter());
app.use('/departments', departmentController.getRouter());
app.use('/admins', adminController.getRouter());
app.use('/auto-replies', autoReplyController.getRouter());
app.use("/agents", macroController.getRouterForRole(AGENT_ROLE_ID));
app.use("/clients", macroController.getRouterForRole(CLIENT_ROLE_ID));
app.use("/change-role", changeRoleController.getRouter());
app.use("/chat", chatController.getRouter());
app.use("/queues", queueController.getRouter());
app.use("/roles", roleController.getRouter());
app.use('/manage-agents', agentController.getRouter());
app.use('/clientAccount', clientAccountController.getRouter()); // ✅ Mobile client account
app.use('/department', mobileDepartmentController.getRouter()); // ✅ Mobile departments
app.use('/messages', mobileMessageController.getRouter()); // ✅ Mobile messages


// ✅ Socket.IO Setup
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:5000', 'http://10.0.2.2:5000'], 
    credentials: true,
  }
});

io.on('connection', (socket) => {
  console.log(`Admin Client connected: ${socket.id}`);
  
  socket.on('mobileConnected', () => {
    console.log('Mobile client connected:', socket.id);
  });
  
  socket.on('joinChatGroup', (groupId) => { 
    socket.join(groupId);
    console.log(`Socket ${socket.id} joined chat_group ${groupId}`);
  });

  socket.on('sendMessage', async (message) => {
    await chatController.handleSendMessage(message, io, socket);

    io.to(message.chatGroupId).emit('newMessage', message.message);
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
