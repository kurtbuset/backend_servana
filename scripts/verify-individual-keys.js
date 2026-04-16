#!/usr/bin/env node
/**
 * Verification script for individual keys implementation
 * Run: node scripts/verify-individual-keys.js
 */

const { cacheManager } = require('../helpers/redisClient');

async function verify() {
  console.log('🔍 Verifying individual keys implementation...\n');

  try {
    // Connect to Redis
    await cacheManager.connect();
    console.log('✅ Connected to Redis\n');

    // Test 1: Set presence for multiple users
    console.log('Test 1: Setting presence for 3 users...');
    await cacheManager.setUserPresence(1, {
      userPresence: 'accepting_chats',
      socketId: 'socket1',
      userType: 'Agent',
      deptIds: [1, 2]
    });
    await cacheManager.setUserPresence(2, {
      userPresence: 'accepting_chats',
      socketId: 'socket2',
      userType: 'Agent',
      deptIds: [1]
    });
    await cacheManager.setUserPresence(3, {
      userPresence: 'not_accepting_chats',
      socketId: 'socket3',
      userType: 'Agent',
      deptIds: [2]
    });
    console.log('✅ Set presence for users 1, 2, 3\n');

    // Test 2: Verify individual keys exist
    console.log('Test 2: Checking individual keys...');
    const keys = await cacheManager.client.keys('user_presence:*');
    console.log(`Found ${keys.length} keys:`, keys);
    
    if (keys.includes('user_presence:1') && 
        keys.includes('user_presence:2') && 
        keys.includes('user_presence:3')) {
      console.log('✅ Individual keys created correctly\n');
    } else {
      console.log('❌ Individual keys not found\n');
      return;
    }

    // Test 3: Verify independent TTLs
    console.log('Test 3: Checking independent TTLs...');
    const ttl1 = await cacheManager.client.ttl('user_presence:1');
    const ttl2 = await cacheManager.client.ttl('user_presence:2');
    const ttl3 = await cacheManager.client.ttl('user_presence:3');
    console.log(`User 1 TTL: ${ttl1} seconds`);
    console.log(`User 2 TTL: ${ttl2} seconds`);
    console.log(`User 3 TTL: ${ttl3} seconds`);
    
    if (ttl1 > 0 && ttl2 > 0 && ttl3 > 0) {
      console.log('✅ All keys have TTL set\n');
    } else {
      console.log('❌ Some keys missing TTL\n');
      return;
    }

    // Test 4: Get single user presence
    console.log('Test 4: Getting single user presence...');
    const user1 = await cacheManager.getUserPresence(1);
    console.log('User 1:', JSON.stringify(user1, null, 2));
    
    if (user1 && user1.userId === 1 && user1.userPresence === 'accepting_chats') {
      console.log('✅ getUserPresence works correctly\n');
    } else {
      console.log('❌ getUserPresence failed\n');
      return;
    }

    // Test 5: Get all accepting_chats users
    console.log('Test 5: Getting all accepting_chats users...');
    const allPresences = await cacheManager.getAllUserPresence();
    console.log(`Found ${Object.keys(allPresences).length} accepting_chats users`);
    console.log('Users:', Object.keys(allPresences));
    
    if (Object.keys(allPresences).length === 2 && 
        allPresences['1'] && allPresences['2'] && !allPresences['3']) {
      console.log('✅ getAllUserPresence filters correctly (only accepting_chats)\n');
    } else {
      console.log('❌ getAllUserPresence filtering failed\n');
      return;
    }

    // Test 6: Update heartbeat (should reset TTL)
    console.log('Test 6: Testing heartbeat TTL reset...');
    const ttlBefore = await cacheManager.client.ttl('user_presence:1');
    console.log(`User 1 TTL before heartbeat: ${ttlBefore} seconds`);
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    
    await cacheManager.updateUserHeartbeat(1);
    const ttlAfter = await cacheManager.client.ttl('user_presence:1');
    console.log(`User 1 TTL after heartbeat: ${ttlAfter} seconds`);
    
    if (ttlAfter > ttlBefore) {
      console.log('✅ Heartbeat resets TTL correctly\n');
    } else {
      console.log('❌ Heartbeat did not reset TTL\n');
      return;
    }

    // Test 7: Verify TTL independence
    console.log('Test 7: Verifying TTL independence...');
    const user2TtlBefore = await cacheManager.client.ttl('user_presence:2');
    console.log(`User 2 TTL before User 1 heartbeat: ${user2TtlBefore} seconds`);
    
    await cacheManager.updateUserHeartbeat(1);
    
    const user2TtlAfter = await cacheManager.client.ttl('user_presence:2');
    console.log(`User 2 TTL after User 1 heartbeat: ${user2TtlAfter} seconds`);
    
    if (user2TtlAfter <= user2TtlBefore) {
      console.log('✅ TTLs are independent (User 1 update did not affect User 2)\n');
    } else {
      console.log('❌ TTLs are not independent\n');
      return;
    }

    // Test 8: Remove user presence
    console.log('Test 8: Testing removeUserPresence...');
    await cacheManager.removeUserPresence(3);
    const user3After = await cacheManager.getUserPresence(3);
    
    if (!user3After) {
      console.log('✅ removeUserPresence works correctly\n');
    } else {
      console.log('❌ removeUserPresence failed\n');
      return;
    }

    // Test 9: Verify old hash doesn't exist
    console.log('Test 9: Checking for old shared hash...');
    const oldHash = await cacheManager.client.exists('user_presence:all');
    
    if (oldHash === 0) {
      console.log('✅ Old shared hash does not exist\n');
    } else {
      console.log('⚠️  Old shared hash still exists (will expire naturally)\n');
    }

    // Cleanup
    console.log('Cleaning up test data...');
    await cacheManager.removeUserPresence(1);
    await cacheManager.removeUserPresence(2);
    console.log('✅ Cleanup complete\n');

    console.log('🎉 All tests passed! Individual keys implementation verified.\n');

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    console.error(error.stack);
  } finally {
    if (cacheManager.client) {
      await cacheManager.client.quit();
      console.log('Disconnected from Redis');
    }
  }
}

// Run verification
verify();
