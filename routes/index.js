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
const clientAccountController = require('../controllers/mobile/clientAccount.controller');
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
  
  // Role management
  app.use('/roles', roleController.getRouter());
  app.use('/change-role', changeRoleController.getRouter());
  
  // Dynamic macro routes (new approach)
  app.use('/macros', macroController.getRouter());
  
  // Mobile routes
  app.use('/clientAccount', clientAccountController.getRouter());
  app.use('/department', mobileDepartmentController.getRouter());
  app.use('/messages', mobileMessageController.getRouter());
}


module.exports = { setupRoutes }; 