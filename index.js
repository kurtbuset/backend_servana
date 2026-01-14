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

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('joinChatGroup', (groupId) => {
    socket.join(groupId);
    console.log(`Socket ${socket.id} joined chat_group ${groupId}`);
  });

  socket.on('sendMessage', async (message) => {
    await handleSendMessage(message, io, socket);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
