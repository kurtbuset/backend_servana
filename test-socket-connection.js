/**
 * Socket.IO Connection Test Script
 * 
 * This script tests the real-time status socket functionality
 * Run with: node test-socket-connection.js
 */

const io = require('socket.io-client');
require('dotenv').config();

const BACKEND_URL = process.env.REACT_WEB_URL || 'http://localhost:5000';
const TEST_USER_ID = 999; // Test user ID
const TEST_USER_NAME = 'Test User';

console.log('🧪 Testing Socket.IO Connection...');
console.log(`📡 Backend URL: ${BACKEND_URL}`);
console.log('');

// Create socket connection
const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5
});

// Connection events
socket.on('connect', () => {
  console.log('✅ Socket connected successfully!');
  console.log(`   Socket ID: ${socket.id}`);
  console.log('');
  
  // Test 1: Emit userOnline
  console.log('📤 Test 1: Emitting userOnline event...');
  socket.emit('userOnline', {
    userId: TEST_USER_ID,
    userType: 'agent',
    userName: TEST_USER_NAME
  });
  
  // Test 2: Request online users list
  setTimeout(() => {
    console.log('📤 Test 2: Requesting online users list...');
    socket.emit('getOnlineUsers');
  }, 1000);
  
  // Test 3: Send heartbeat
  setTimeout(() => {
    console.log('📤 Test 3: Sending heartbeat...');
    socket.emit('userHeartbeat', {
      userId: TEST_USER_ID
    });
  }, 2000);
  
  // Test 4: Go offline
  setTimeout(() => {
    console.log('📤 Test 4: Going offline...');
    socket.emit('userOffline', {
      userId: TEST_USER_ID
    });
  }, 3000);
  
  // Disconnect after tests
  setTimeout(() => {
    console.log('');
    console.log('🏁 All tests completed!');
    console.log('💡 Check backend logs for detailed output');
    socket.disconnect();
    process.exit(0);
  }, 4000);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
  console.error('');
  console.error('💡 Troubleshooting:');
  console.error('   1. Make sure backend server is running');
  console.error('   2. Check BACKEND_URL is correct');
  console.error('   3. Verify CORS configuration');
  process.exit(1);
});

socket.on('disconnect', (reason) => {
  console.log('');
  console.log(`🔌 Disconnected: ${reason}`);
});

// Listen for server events
socket.on('userStatusChanged', (data) => {
  console.log('📥 Received userStatusChanged:', {
    userId: data.userId,
    status: data.status,
    lastSeen: data.lastSeen
  });
});

socket.on('onlineUsersList', (users) => {
  console.log('📥 Received onlineUsersList:');
  console.log(`   Total online users: ${users.length}`);
  users.forEach(user => {
    console.log(`   - User ${user.userId} (${user.userName || 'Unknown'}): ${user.status}`);
  });
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('');
  console.log('⚠️  Test interrupted');
  socket.disconnect();
  process.exit(0);
});
