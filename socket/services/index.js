/**
 * Socket Services Index
 * Exports all service modules
 */

const CustomerListService = require('./customer-list.service');
const RoomManagementService = require('./room-management.service');

module.exports = {
  CustomerListService,
  RoomManagementService
};
