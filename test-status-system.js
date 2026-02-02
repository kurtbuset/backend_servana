/**
 * User Status System Test Script
 * 
 * This script tests the complete user status functionality
 * Run with: node test-status-system.js
 */

const io = require('socket.io-client');
require('dotenv').config();

const BACKEND_URL = `http://localhost:${process.env.PORT || 3000}`;
const TEST_USER_1 = { id: 101, name: 'Test User 1', type: 'agent' };
const TEST_USER_2 = { id: 102, name: 'Test User 2', type: 'agent' };

console.log('🧪 Testing User Status System...');
console.log(`📡 Backend URL: ${BACKEND_URL}`);
console.log('');

// Create two socket connections to simulate multiple users
const socket1 = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
});

const socket2 = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
});

let testsPassed = 0;
let testsFailed = 0;

function logTest(name, passed, message = '') {
  if (passed) {
    console.log(`✅ ${name}`);
    testsPassed++;
  } else {
    console.log(`❌ ${name} - ${message}`);
    testsFailed++;
  }
}

// Test 1: Socket Connection
socket1.on('connect', () => {
  logTest('Test 1: Socket 1 connected', true);
  
  // Test 2: Emit userOnline
  console.log('');
  console.log('📤 Test 2: Emitting userOnline for User 1...');
  socket1.emit('userOnline', {
    userId: TEST_USER_1.id,
    userType: TEST_USER_1.type,
    userName: TEST_USER_1.name
  });
});

socket2.on('connect', () => {
  logTest('Test 3: Socket 2 connected', true);
  
  // Wait a bit for socket1 to be online first
  setTimeout(() => {
    console.log('');
    console.log('📤 Test 4: Emitting userOnline for User 2...');
    socket2.emit('userOnline', {
      userId: TEST_USER_2.id,
      userType: TEST_USER_2.type,
      userName: TEST_USER_2.name
    });
  }, 1000);
});

// Test 5: Listen for userStatusChanged on socket1
socket1.on('userStatusChanged', (data) => {
  if (data.userId === TEST_USER_1.id) {
    logTest('Test 5: User 1 received own status change', true);
  } else if (data.userId === TEST_USER_2.id) {
    logTest('Test 6: User 1 received User 2 status change', true);
  }
});

// Test 7: Listen for userStatusChanged on socket2
socket2.on('userStatusChanged', (data) => {
  if (data.userId === TEST_USER_2.id) {
    logTest('Test 7: User 2 received own status change', true);
  } else if (data.userId === TEST_USER_1.id) {
    logTest('Test 8: User 2 received User 1 status change', true);
  }
});

// Test 9: Request online users list
setTimeout(() => {
  console.log('');
  console.log('📤 Test 9: Requesting online users list...');
  socket1.emit('getOnlineUsers');
}, 2000);

// Test 10: Receive online users list
socket1.on('onlineUsersList', (users) => {
  console.log('📥 Received online users list:');
  users.forEach(user => {
    console.log(`   - User ${user.userId} (${user.userName}): ${user.status}`);
  });
  
  const hasUser1 = users.some(u => u.userId === TEST_USER_1.id);
  const hasUser2 = users.some(u => u.userId === TEST_USER_2.id);
  
  logTest('Test 10: Online users list contains User 1', hasUser1, 'User 1 not found');
  logTest('Test 11: Online users list contains User 2', hasUser2, 'User 2 not found');
});

// Test 12: Send heartbeat
setTimeout(() => {
  console.log('');
  console.log('📤 Test 12: Sending heartbeat for User 1...');
  socket1.emit('userHeartbeat', { userId: TEST_USER_1.id });
}, 3000);

// Test 13: User goes offline
setTimeout(() => {
  console.log('');
  console.log('📤 Test 13: User 1 going offline...');
  socket1.emit('userOffline', { userId: TEST_USER_1.id });
}, 4000);

// Test 14: Disconnect
setTimeout(() => {
  console.log('');
  console.log('📤 Test 14: Disconnecting sockets...');
  socket1.disconnect();
  socket2.disconnect();
}, 5000);

// Summary
setTimeout(() => {
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('📊 Test Summary');
  console.log('═══════════════════════════════════════');
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);
  console.log('');
  
  if (testsFailed === 0) {
    console.log('🎉 All tests passed! User status system is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check backend logs for details.');
  }
  
  process.exit(testsFailed === 0 ? 0 : 1);
}, 6000);

// Error handling
socket1.on('connect_error', (error) => {
  console.error('❌ Socket 1 connection error:', error.message);
  testsFailed++;
});

socket2.on('connect_error', (error) => {
  console.error('❌ Socket 2 connection error:', error.message);
  testsFailed++;
});

socket1.on('disconnect', (reason) => {
  console.log(`🔌 Socket 1 disconnected: ${reason}`);
});

socket2.on('disconnect', (reason) => {
  console.log(`🔌 Socket 2 disconnected: ${reason}`);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('');
  console.log('⚠️  Test interrupted');
  socket1.disconnect();
  socket2.disconnect();
  process.exit(1);
});
