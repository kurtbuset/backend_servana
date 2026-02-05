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
  
  // Role-based macro routes
  await initializeRoleBasedRoutes(app);
  
  // Mobile routes
  app.use('/clientAccount', clientAccountController.getRouter());
  app.use('/department', mobileDepartmentController.getRouter());
  app.use('/messages', mobileMessageController.getRouter());
}

async function initializeRoleBasedRoutes(app) {
  try {
    const [AGENT_ROLE_ID, CLIENT_ROLE_ID] = await Promise.all([
      roleService.getRoleId('Agent'),
      roleService.getRoleId('Client'),
    ]);
    
    app.use('/agents', macroController.getRouterForRole(AGENT_ROLE_ID));
    app.use('/clients', macroController.getRouterForRole(CLIENT_ROLE_ID));
    
    console.log('✅ Role-based routes initialized');
  } catch (error) {
    console.error('❌ Failed to initialize role-based routes:', error.message);
    process.exit(1);
  }
}

module.exports = { setupRoutes };