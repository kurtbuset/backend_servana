/**
 * Centralized permission constants
 * Single source of truth for all privilege names
 */

const PERMISSIONS = {
  // Account Management
  CREATE_ACCOUNT: 'priv_can_create_account',
  MANAGE_PROFILE: 'priv_can_manage_profile',
  
  // Department Management
  VIEW_DEPT: 'priv_can_view_dept',
  ADD_DEPT: 'priv_can_add_dept',
  EDIT_DEPT: 'priv_can_edit_dept',
  MANAGE_DEPT: 'priv_can_manage_dept', // Legacy - kept for backward compatibility
  ASSIGN_DEPT: 'priv_can_assign_dept',
  
  // Role Management
  MANAGE_ROLE: 'priv_can_manage_role',
  ASSIGN_ROLE: 'priv_can_assign_role', // Legacy - kept for backward compatibility
  VIEW_CHANGE_ROLES: 'priv_can_view_change_roles',
  EDIT_CHANGE_ROLES: 'priv_can_edit_change_roles',
  
  // Message Management
  VIEW_MESSAGE: 'priv_can_view_message',
  SEND_MESSAGE: 'priv_can_message',
  END_CHAT: 'priv_can_end_chat',
  CAN_TRANSFER: 'priv_can_transfer',
  
  // Auto Reply Management
  VIEW_AUTO_REPLY: 'priv_can_view_auto_reply',
  ADD_AUTO_REPLY: 'priv_can_add_auto_reply',
  EDIT_AUTO_REPLY: 'priv_can_edit_auto_reply',
  DELETE_AUTO_REPLY: 'priv_can_delete_auto_reply',
  MANAGE_AUTO_REPLY: 'priv_can_manage_auto_reply', // Legacy - kept for backward compatibility
  
  // Canned Messages / Macros
  VIEW_MACROS: 'priv_can_view_macros',
  ADD_MACROS: 'priv_can_add_macros',
  EDIT_MACROS: 'priv_can_edit_macros',
  DELETE_MACROS: 'priv_can_delete_macros',
  USE_CANNED_MESS: 'priv_can_use_canned_mess', // Legacy - kept for backward compatibility 
  
  // Manage Agents Permissions
  VIEW_MANAGE_AGENTS: 'priv_can_view_manage_agents',
  VIEW_AGENTS_INFO: 'priv_can_view_agents_info',
  CREATE_AGENT_ACCOUNT: 'priv_can_create_agent_account',
  EDIT_MANAGE_AGENTS: 'priv_can_edit_manage_agents',
  EDIT_DEPT_MANAGE_AGENTS: 'priv_can_edit_dept_manage_agents',
  VIEW_ANALYTICS_MANAGE_AGENTS: 'priv_can_view_analytics_manage_agents',
};

// Helper functions
const getAllPermissions = () => Object.values(PERMISSIONS);


const isValidPermission = (permission) => getAllPermissions().includes(permission);

module.exports = {
  PERMISSIONS,
  getAllPermissions,
  isValidPermission,
};