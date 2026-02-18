/**
 * Centralized permission constants
 * Single source of truth for all privilege names
 */

const PERMISSIONS = {
  // Account Management
  CREATE_ACCOUNT: 'priv_can_create_account',
  MANAGE_PROFILE: 'priv_can_manage_profile',
  
  // Department Management
  MANAGE_DEPT: 'priv_can_manage_dept',
  ASSIGN_DEPT: 'priv_can_assign_dept',
  
  // Role Management
  MANAGE_ROLE: 'priv_can_manage_role',
  ASSIGN_ROLE: 'priv_can_assign_role',
  
  // Message Management
  VIEW_MESSAGE: 'priv_can_view_message',
  SEND_MESSAGE: 'priv_can_message',
  END_CHAT: 'priv_can_end_chat',
  CAN_TRANSFER: 'priv_can_transfer',
  
  // Auto Reply Management
  MANAGE_AUTO_REPLY: 'priv_can_manage_auto_reply',
  
  // Canned Messages
  USE_CANNED_MESS: 'priv_can_use_canned_mess', 
};

// Helper functions
const getAllPermissions = () => Object.values(PERMISSIONS);


const isValidPermission = (permission) => getAllPermissions().includes(permission);

module.exports = {
  PERMISSIONS,
  getAllPermissions,
  isValidPermission,
};