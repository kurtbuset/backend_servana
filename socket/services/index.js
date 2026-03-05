/**
 * Socket Services Index
 * Exports all service modules
 */

const CustomerListService = require('./customerListService');
const RoomManagementService = require('./roomManagementService');

module.exports = {
  CustomerListService,
  RoomManagementService
};
