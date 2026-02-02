/**
 * Security Test Script for Last Seen Data Storage
 * Tests all security measures implemented in userStatusHandlers.js
 */

const io = require('socket.io-client');
require('dotenv').config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const TEST_USER_ID = 999; // Use a test user ID
const TEST_USER_NAME = 'Security Test User';
const TEST_USER_TYPE = 'agent';

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, passed, message) {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}: ${name}`);
  if (message) console.log(`   ${message}`);
  
  results.tests.push({ name, passed, message });
  if (passed) results.passed++;
  else results.failed++;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSecurityTests() {
  console.log('🔒 Starting Security Tests for Last Seen Data Storage\n');
  console.log(`Backend URL: ${BACKEND_URL}\n`);

  // Test 1: Input Validation - Invalid userId Type
  console.log('📋 Test 1: Input Validation - Invalid userId Type');
  try {
    const socket1 = io(BACKEND_URL, { transports: ['websocket'] });
    
    await new Promise((resolve) => {
      socket1.on('connect', () => {
        socket1.emit('userOnline', {
          userId: 'invalid_string', // Should be number
          userType: TEST_USER_TYPE,
          userName: TEST_USER_NAME
        });
        
        socket1.on('error', (error) => {
          if (error.message.includes('Invalid')) {
            logTest('Invalid userId Type', true, 'Server rejected invalid userId type');
            socket1.disconnect();
            resolve();
          }
        });
        
        // Timeout if no error received
        setTimeout(() => {
          logTest('Invalid userId Type', false, 'Server did not reject invalid userId');
          socket1.disconnect();
          resolve();
        }, 2000);
      });
    });
  } catch (error) {
    logTest('Invalid userId Type', false, error.message);
  }

  await sleep(1000);

  // Test 2: Input Validation - Missing Required Fields
  console.log('\n📋 Test 2: Input Validation - Missing Required Fields');
  try {
    const socket2 = io(BACKEND_URL, { transports: ['websocket'] });
    
    await new Promise((resolve) => {
      socket2.on('connect', () => {
        socket2.emit('userOnline', {
          userId: TEST_USER_ID
          // Missing userType and userName
        });
        
        socket2.on('error', (error) => {
          if (error.message.includes('Invalid') || error.message.includes('missing')) {
            logTest('Missing Required Fields', true, 'Server rejected missing fields');
            socket2.disconnect();
            resolve();
          }
        });
        
        setTimeout(() => {
          logTest('Missing Required Fields', false, 'Server did not reject missing fields');
          socket2.disconnect();
          resolve();
        }, 2000);
      });
    });
  } catch (error) {
    logTest('Missing Required Fields', false, error.message);
  }

  await sleep(1000);

  // Test 3: Input Validation - String Length Limits
  console.log('\n📋 Test 3: Input Validation - String Length Limits');
  try {
    const socket3 = io(BACKEND_URL, { transports: ['websocket'] });
    
    await new Promise((resolve) => {
      socket3.on('connect', () => {
        socket3.emit('userOnline', {
          userId: TEST_USER_ID,
          userType: TEST_USER_TYPE,
          userName: 'A'.repeat(101) // Exceeds 100 character limit
        });
        
        socket3.on('error', (error) => {
          if (error.message.includes('too long')) {
            logTest('String Length Limits', true, 'Server rejected oversized string');
            socket3.disconnect();
            resolve();
          }
        });
        
        setTimeout(() => {
          logTest('String Length Limits', false, 'Server did not reject oversized string');
          socket3.disconnect();
          resolve();
        }, 2000);
      });
    });
  } catch (error) {
    logTest('String Length Limits', false, error.message);
  }

  await sleep(1000);

  // Test 4: Rate Limiting
  console.log('\n📋 Test 4: Rate Limiting (10 updates per minute)');
  try {
    const socket4 = io(BACKEND_URL, { transports: ['websocket'] });
    let errorReceived = false;
    
    await new Promise((resolve) => {
      socket4.on('connect', () => {
        // Send 12 rapid requests (should hit rate limit at 11th)
        for (let i = 0; i < 12; i++) {
          socket4.emit('userOnline', {
            userId: TEST_USER_ID + 100, // Different user to avoid conflicts
            userType: TEST_USER_TYPE,
            userName: `Rate Test ${i}`
          });
        }
        
        socket4.on('error', (error) => {
          if (error.message.includes('Rate limit')) {
            errorReceived = true;
            logTest('Rate Limiting', true, `Rate limit enforced: ${error.message}`);
            socket4.disconnect();
            resolve();
          }
        });
        
        setTimeout(() => {
          if (!errorReceived) {
            logTest('Rate Limiting', false, 'Rate limit not enforced after 12 requests');
          }
          socket4.disconnect();
          resolve();
        }, 3000);
      });
    });
  } catch (error) {
    logTest('Rate Limiting', false, error.message);
  }

  await sleep(1000);

  // Test 5: Socket Ownership Verification
  console.log('\n📋 Test 5: Socket Ownership Verification');
  try {
    const socket5 = io(BACKEND_URL, { transports: ['websocket'] });
    let hijackAttemptBlocked = false;
    
    await new Promise((resolve) => {
      socket5.on('connect', () => {
        // First, establish ownership with user 200
        socket5.emit('userOnline', {
          userId: TEST_USER_ID + 200,
          userType: TEST_USER_TYPE,
          userName: 'Owner Test 1'
        });
        
        // Wait a bit, then try to hijack with different user
        setTimeout(() => {
          socket5.emit('userOnline', {
            userId: TEST_USER_ID + 201, // Different user
            userType: TEST_USER_TYPE,
            userName: 'Hijack Attempt'
          });
        }, 500);
        
        socket5.on('error', (error) => {
          if (error.message.includes('already assigned') || error.message.includes('hijacking')) {
            hijackAttemptBlocked = true;
            logTest('Socket Ownership Verification', true, 'Socket hijacking attempt blocked');
            socket5.disconnect();
            resolve();
          }
        });
        
        setTimeout(() => {
          if (!hijackAttemptBlocked) {
            logTest('Socket Ownership Verification', false, 'Socket hijacking not prevented');
          }
          socket5.disconnect();
          resolve();
        }, 3000);
      });
    });
  } catch (error) {
    logTest('Socket Ownership Verification', false, error.message);
  }

  await sleep(1000);

  // Test 6: Authorization Check for Heartbeat
  console.log('\n📋 Test 6: Authorization Check for Heartbeat');
  try {
    const socket6 = io(BACKEND_URL, { transports: ['websocket'] });
    let unauthorizedBlocked = false;
    
    await new Promise((resolve) => {
      socket6.on('connect', () => {
        // Establish ownership with user 300
        socket6.emit('userOnline', {
          userId: TEST_USER_ID + 300,
          userType: TEST_USER_TYPE,
          userName: 'Auth Test'
        });
        
        // Wait, then try to send heartbeat for different user
        setTimeout(() => {
          socket6.emit('userHeartbeat', {
            userId: TEST_USER_ID + 301 // Different user
          });
        }, 500);
        
        socket6.on('error', (error) => {
          if (error.message.includes('Unauthorized')) {
            unauthorizedBlocked = true;
            logTest('Authorization Check for Heartbeat', true, 'Unauthorized heartbeat blocked');
            socket6.disconnect();
            resolve();
          }
        });
        
        setTimeout(() => {
          if (!unauthorizedBlocked) {
            logTest('Authorization Check for Heartbeat', false, 'Unauthorized heartbeat not blocked');
          }
          socket6.disconnect();
          resolve();
        }, 3000);
      });
    });
  } catch (error) {
    logTest('Authorization Check for Heartbeat', false, error.message);
  }

  await sleep(1000);

  // Test 7: Authorization Check for Offline
  console.log('\n📋 Test 7: Authorization Check for Offline');
  try {
    const socket7 = io(BACKEND_URL, { transports: ['websocket'] });
    let unauthorizedBlocked = false;
    
    await new Promise((resolve) => {
      socket7.on('connect', () => {
        // Establish ownership with user 400
        socket7.emit('userOnline', {
          userId: TEST_USER_ID + 400,
          userType: TEST_USER_TYPE,
          userName: 'Offline Auth Test'
        });
        
        // Wait, then try to set different user offline
        setTimeout(() => {
          socket7.emit('userOffline', {
            userId: TEST_USER_ID + 401 // Different user
          });
        }, 500);
        
        socket7.on('error', (error) => {
          if (error.message.includes('Unauthorized')) {
            unauthorizedBlocked = true;
            logTest('Authorization Check for Offline', true, 'Unauthorized offline blocked');
            socket7.disconnect();
            resolve();
          }
        });
        
        setTimeout(() => {
          if (!unauthorizedBlocked) {
            logTest('Authorization Check for Offline', false, 'Unauthorized offline not blocked');
          }
          socket7.disconnect();
          resolve();
        }, 3000);
      });
    });
  } catch (error) {
    logTest('Authorization Check for Offline', false, error.message);
  }

  await sleep(1000);

  // Test 8: Valid Request Should Succeed
  console.log('\n📋 Test 8: Valid Request Should Succeed');
  try {
    const socket8 = io(BACKEND_URL, { transports: ['websocket'] });
    let statusChanged = false;
    
    await new Promise((resolve) => {
      socket8.on('connect', () => {
        socket8.emit('userOnline', {
          userId: TEST_USER_ID + 500,
          userType: TEST_USER_TYPE,
          userName: 'Valid Test User'
        });
        
        socket8.on('userStatusChanged', (data) => {
          if (data.userId === TEST_USER_ID + 500 && data.status === 'online') {
            statusChanged = true;
            logTest('Valid Request Should Succeed', true, 'Valid request processed successfully');
            socket8.disconnect();
            resolve();
          }
        });
        
        setTimeout(() => {
          if (!statusChanged) {
            logTest('Valid Request Should Succeed', false, 'Valid request not processed');
          }
          socket8.disconnect();
          resolve();
        }, 3000);
      });
    });
  } catch (error) {
    logTest('Valid Request Should Succeed', false, error.message);
  }

  // Print Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SECURITY TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${results.tests.length}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Success Rate: ${((results.passed / results.tests.length) * 100).toFixed(1)}%`);
  console.log('='.repeat(60));

  if (results.failed === 0) {
    console.log('\n🎉 All security tests passed! The system is secure.');
  } else {
    console.log('\n⚠️ Some security tests failed. Please review the implementation.');
  }

  process.exit(results.failed === 0 ? 0 : 1);
}

// Run tests
runSecurityTests().catch(error => {
  console.error('❌ Test suite error:', error);
  process.exit(1);
});
