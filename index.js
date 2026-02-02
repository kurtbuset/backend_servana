const express = require('express');
const helmet = require('helmet')
const cors = require('cors');
const cookieParser = require('cookie-parser'); // ✅ Required for HTTP-only cookies
require('dotenv').config();

// Controllers
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
app.use(helmet())
const http = require('http');
const { initializeSocket } = require('./socket');
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
const io = initializeSocket(server, allowedOrigins);

// Make io instance available to routes
app.set('io', io);

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});