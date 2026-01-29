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
const roleService = require('./services/role.service');

const app = express();
const http = require('http');
const socketIo = require('socket.io');
const port = process.env.PORT || 3000;

// ✅ Middleware
app.use(express.static("public"));

// Dynamic allowed origins from environment variables
const allowedOrigins = [
  process.env.REACT_WEB_URL || 'http://localhost:5173', // Development React web
  process.env.REACT_WEB_PRODUCTION_URL, // Production React web
  'http://localhost:5000', // Mobile development
  'http://10.0.2.2:5000', // Android emulator
].filter(Boolean); // Remove undefined values

console.log('🌐 Allowed CORS origins:', allowedOrigins);

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

// Initialize role-based routes
async function initializeRoleBasedRoutes() {
  try {
    const [AGENT_ROLE_ID, CLIENT_ROLE_ID] = await Promise.all([
      roleService.getRoleId("Agent"),
      roleService.getRoleId("Client")
    ]);
    
    app.use("/agents", macroController.getRouterForRole(AGENT_ROLE_ID));
    app.use("/clients", macroController.getRouterForRole(CLIENT_ROLE_ID));
    
    console.log(`✅ Role-based routes initialized successfully`);
  } catch (error) {
    console.error('❌ Failed to initialize role-based routes:', error.message);
    process.exit(1);
  }
}

// Initialize routes
initializeRoleBasedRoutes();

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
    origin: allowedOrigins, // Use the same allowed origins as CORS
    credentials: true,
  }
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Join a chat group room - with room switching support
  socket.on('joinChatGroup', (data) => {
    const { groupId, userType, userId } = data;
    
    // Leave previous room if agent was in another room
    if (socket.chatGroupId && socket.chatGroupId !== groupId) {
      socket.leave(String(socket.chatGroupId));
      
      // Notify previous room that agent left
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: socket.userType,
        userId: socket.userId,
        chatGroupId: socket.chatGroupId
      });
      
      console.log(`${userType} ${userId} left chat_group ${socket.chatGroupId}`);
    }
    
    // Join new room
    socket.join(String(groupId));
    socket.chatGroupId = groupId;
    socket.userType = userType;
    socket.userId = userId;
    
    console.log(`${userType} ${userId} joined chat_group ${groupId}`);
    
    // Notify new room that user joined
    socket.to(String(groupId)).emit('userJoined', {
      userType,
      userId,
      chatGroupId: groupId
    });
  });

  // Handle explicit room leaving
  socket.on('leavePreviousRoom', () => {
    if (socket.chatGroupId) {
      socket.leave(String(socket.chatGroupId));
      
      // Notify room that agent left
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: socket.userType,
        userId: socket.userId,
        chatGroupId: socket.chatGroupId
      });
      
      console.log(`${socket.userType} ${socket.userId} left chat_group ${socket.chatGroupId}`);
    }
  });

  // Handle specific room leaving
  socket.on('leaveRoom', (roomId) => {
    socket.leave(String(roomId));
    
    // Notify room that user left
    socket.to(String(roomId)).emit('userLeft', {
      userType: socket.userType,
      userId: socket.userId,
      chatGroupId: roomId
    });
    
    console.log(`${socket.userType} ${socket.userId} left chat_group ${roomId}`);
  });

  // Handle typing event
  socket.on('typing', (data) => {
    const { chat_group_id, userName, userId } = data;
    // Broadcast to all users in the chat group except sender
    socket.to(chat_group_id).emit('userTyping', {
      userName: userName || 'Someone',
      userId,
      isCurrentUser: false,
    });
  });

  // Handle stop typing event
  socket.on('stopTyping', (data) => {
    const { chat_group_id } = data;
    socket.to(chat_group_id).emit('userStoppedTyping');
  });

  // Handle message from web (agent)
  socket.on('sendMessage', async (messageData) => {
    console.log('Message from web agent:', messageData);
    
    try {
      // Save message to database via controller
      const savedMessage = await chatController.handleSendMessage(messageData, io, socket);
      
      if (savedMessage) {
        const roomId = String(messageData.chat_group_id);
        
        // Always broadcast to the chat_group room - real-time if client is in same room
        io.to(roomId).emit('receiveMessage', savedMessage);
        io.to(roomId).emit('newMessage', savedMessage);
        
        console.log(`✅ Message broadcasted to chat_group ${messageData.chat_group_id}`);
      }
    } catch (error) {
      console.error('Error handling sendMessage:', error);
      socket.emit('messageError', { error: 'Failed to send message' });
    }
  });

  // Handle message from mobile (client)
  socket.on('sendMessageMobile', async (messageData) => {
    console.log('Message from mobile client:', messageData);
    
    try {
      const roomId = String(messageData.chat_group_id);
      
      // Always broadcast to the chat_group room - real-time if agent is in same room
      io.to(roomId).emit('newMessage', messageData);
      io.to(roomId).emit('receiveMessage', messageData);
      
      console.log(`✅ Mobile message broadcasted to chat_group ${messageData.chat_group_id}`);
    } catch (error) {
      console.error('Error handling sendMessageMobile:', error);
      socket.emit('messageError', { error: 'Failed to send message' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    
    // Notify room members about user leaving
    if (socket.chatGroupId && socket.userType) {
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: socket.userType,
        userId: socket.userId,
        chatGroupId: socket.chatGroupId
      });
    }
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
