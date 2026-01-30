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

// Store online users: { userId: { socketId, lastSeen, userType } }
const onlineUsers = new Map();

// Cleanup job: Check for stale users every 60 seconds
setInterval(() => {
  const now = new Date();
  const staleThreshold = 60000; // 60 seconds (2x heartbeat interval)
  
  onlineUsers.forEach((userData, userId) => {
    const timeSinceLastSeen = now - userData.lastSeen;
    
    if (timeSinceLastSeen > staleThreshold) {
      console.log(`🧹 Cleaning up stale user ${userId} (last seen ${Math.floor(timeSinceLastSeen / 1000)}s ago)`);
      
      // Remove from online users
      onlineUsers.delete(userId);
      
      // Broadcast offline status
      io.emit('userStatusChanged', {
        userId,
        status: 'offline',
        lastSeen: userData.lastSeen
      });
      
      // Update database
      const supabase = require('./helpers/supabaseClient');
      supabase
        .from('sys_user')
        .update({ last_seen: userData.lastSeen.toISOString() })
        .eq('sys_user_id', userId)
        .then(() => console.log(`💾 Updated stale user ${userId} in database`))
        .catch(err => console.error('❌ Error updating stale user:', err));
    }
  });
}, 60000); // Run every 60 seconds

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Handle user coming online
  socket.on('userOnline', async (data) => {
    const { userId, userType, userName } = data;
    
    console.log('🟢 userOnline event received:', { userId, userType, userName, socketId: socket.id });
    
    // Store user as online
    onlineUsers.set(userId, {
      socketId: socket.id,
      lastSeen: new Date(),
      userType,
      userName
    });
    
    socket.userId = userId;
    socket.userType = userType;
    
    console.log(`✅ User ${userId} (${userName}) is now online. Total online: ${onlineUsers.size}`);
    
    // Broadcast to all clients that this user is online
    io.emit('userStatusChanged', {
      userId,
      status: 'online',
      lastSeen: new Date()
    });
    
    console.log('📡 Broadcasted userStatusChanged to all clients');
    
    // Update last_seen in database
    try {
      const supabase = require('./helpers/supabaseClient');
      await supabase
        .from('sys_user')
        .update({ last_seen: new Date().toISOString() })
        .eq('sys_user_id', userId);
      console.log('💾 Updated last_seen in database for user:', userId);
    } catch (error) {
      console.error('❌ Error updating last_seen:', error);
    }
  });
  
  // Handle heartbeat to keep user online
  socket.on('userHeartbeat', async (data) => {
    const { userId } = data;
    
    if (onlineUsers.has(userId)) {
      // Update last seen timestamp
      const userData = onlineUsers.get(userId);
      const lastSeen = new Date();
      userData.lastSeen = lastSeen;
      onlineUsers.set(userId, userData);
      
      console.log(`💓 Heartbeat from user ${userId}`);
      
      // Broadcast status update to all clients (so they see user is online immediately)
      io.emit('userStatusChanged', {
        userId,
        status: 'online',
        lastSeen
      });
      
      // Update database
      try {
        const supabase = require('./helpers/supabaseClient');
        await supabase
          .from('sys_user')
          .update({ last_seen: lastSeen.toISOString() })
          .eq('sys_user_id', userId);
      } catch (error) {
        console.error('❌ Error updating heartbeat:', error);
      }
    }
  });
  
  // Handle user going offline
  socket.on('userOffline', async (data) => {
    const { userId } = data;
    
    if (onlineUsers.has(userId)) {
      onlineUsers.delete(userId);
      
      const lastSeen = new Date();
      
      console.log(`❌ User ${userId} went offline`);
      
      // Broadcast to all clients that this user is offline
      io.emit('userStatusChanged', {
        userId,
        status: 'offline',
        lastSeen
      });
      
      // Update last_seen in database
      try {
        const supabase = require('./helpers/supabaseClient');
        await supabase
          .from('sys_user')
          .update({ last_seen: lastSeen.toISOString() })
          .eq('sys_user_id', userId);
      } catch (error) {
        console.error('Error updating last_seen:', error);
      }
    }
  });
  
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
      
      // Use fallback values to avoid "undefined undefined"
      const userType = socket.userType || 'agent';
      const userId = socket.userId || 'unknown';
      
      // Notify room that agent left
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: userType,
        userId: userId,
        chatGroupId: socket.chatGroupId
      });
      
      console.log(`${userType} ${userId} left chat_group ${socket.chatGroupId}`);
    }
  });

  // Handle specific room leaving
  socket.on('leaveRoom', (data) => {
    // Handle both old format (just roomId) and new format (object with roomId, userType, userId)
    let roomId, userType, userId;
    
    if (typeof data === 'object' && data.roomId) {
      // New format: { roomId, userType, userId }
      roomId = data.roomId;
      userType = data.userType || socket.userType || 'unknown';
      userId = data.userId || socket.userId || 'unknown';
    } else {
      // Old format: just roomId string/number
      roomId = data;
      userType = socket.userType || 'unknown';
      userId = socket.userId || 'unknown';
    }
    
    socket.leave(String(roomId));
    
    // Notify room that user left with proper user info
    socket.to(String(roomId)).emit('userLeft', {
      userType: userType,
      userId: userId,
      chatGroupId: roomId
    });
    
    console.log(`${userType} ${userId} left chat_group ${roomId}`);
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

  socket.on('disconnect', async () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    console.log(`   Socket userId: ${socket.userId}`);
    console.log(`   Socket userType: ${socket.userType}`);
    
    // Notify room members about user leaving
    if (socket.chatGroupId && socket.userType) {
      socket.to(String(socket.chatGroupId)).emit('userLeft', {
        userType: socket.userType,
        userId: socket.userId,
        chatGroupId: socket.chatGroupId
      });
    }
    
    // Handle user going offline on disconnect
    if (socket.userId) {
      const userId = socket.userId;
      
      if (onlineUsers.has(userId)) {
        const userData = onlineUsers.get(userId);
        
        // Only remove if this socket ID matches
        if (userData.socketId === socket.id) {
          onlineUsers.delete(userId);
          
          const lastSeen = new Date();
          
          console.log(`❌ User ${userId} went offline (disconnected) - Socket ${socket.id}`);
          
          // Broadcast to all clients that this user is offline
          io.emit('userStatusChanged', {
            userId,
            status: 'offline',
            lastSeen
          });
          
          // Update last_seen in database
          try {
            const supabase = require('./helpers/supabaseClient');
            await supabase
              .from('sys_user')
              .update({ last_seen: lastSeen.toISOString() })
              .eq('sys_user_id', userId);
          } catch (error) {
            console.error('Error updating last_seen:', error);
          }
        } else {
          console.log(`⚠️ Socket ${socket.id} disconnected but user ${userId} has different active socket ${userData.socketId}`);
        }
      } else {
        console.log(`⚠️ User ${userId} not found in onlineUsers Map`);
      }
    } else {
      console.log(`⚠️ Socket ${socket.id} disconnected without userId`);
    }
  });
  
  // Get online users list
  socket.on('getOnlineUsers', () => {
    const onlineUsersList = Array.from(onlineUsers.entries()).map(([userId, data]) => ({
      userId,
      status: 'online',
      lastSeen: data.lastSeen,
      userType: data.userType,
      userName: data.userName
    }));
    
    console.log(`📋 getOnlineUsers request from ${socket.id}. Sending ${onlineUsersList.length} users`);
    
    socket.emit('onlineUsersList', onlineUsersList);
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
