const authController = require('../controllers/auth.controller');
const profileController = require('../controllers/profile.controller');
const departmentController = require('../controllers/department.controller');
const adminController = require('../controllers/admin.controller');
const autoReplyController = require('../controllers/autoReply.controller');
const macroController = require('../controllers/macro.controller');
const changeRoleController = require('../controllers/changeRole.controller');
const chatController = require('../controllers/chat.controller');
const queueController = require('../controllers/queue.controller');
const roleController = require('../controllers/role.controller');
const agentController = require('../controllers/agent.controller');
const analyticsController = require('../controllers/analytics.controller');
const clientAccountController = require('../controllers/mobile/clientAccount.controller');
const otpController = require('../controllers/mobile/otp.controller');
const mobileDepartmentController = require('../controllers/mobile/department.controller');
const mobileMessageController = require('../controllers/mobile/message.controller');
const roleService = require('../services/role.service');

async function setupRoutes(app) {
  // Health check endpoint for mobile testing
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'OK', 
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      ip: req.ip || req.connection.remoteAddress
    });
  });

  // Auth routes
  app.use('/auth', authController.getRouter());
  
  // Profile & Admin routes
  app.use('/profile', profileController.getRouter());
  app.use('/admins', adminController.getRouter());
  app.use('/manage-agents', agentController.getRouter());
  
  // Department & Queue routes
  app.use('/departments', departmentController.getRouter());
  app.use('/queues', queueController.getRouter());
  
  // Chat & Communication routes
  app.use('/chat', chatController.getRouter());
  app.use('/auto-replies', autoReplyController.getRouter());
  
  // Analytics routes
  app.use('/analytics', analyticsController.getRouter());
  
  // Test endpoint for analytics
  app.get('/test-analytics', (req, res) => {
    res.json({ 
      message: 'Analytics routes are working!',
      timestamp: new Date().toISOString(),
      availableRoutes: [
        'GET /analytics/messages',
        'GET /analytics/response-time', 
        'GET /analytics/enhanced-response-time',
        'GET /analytics/agent-performance',
        'GET /analytics/dashboard-stats'
      ]
    });
  });
  
  // Role management
  app.use('/roles', roleController.getRouter());
  app.use('/change-role', changeRoleController.getRouter());
  
  // Dynamic macro routes (new approach)
  app.use('/macros', macroController.getRouter());
  
  // Mobile routes
  app.use('/otp', otpController.getRouter());
  app.use('/clientAccount', clientAccountController.getRouter());
  app.use('/department', mobileDepartmentController.getRouter());
  app.use('/messages', mobileMessageController.getRouter());
}


module.exports = { setupRoutes }; 