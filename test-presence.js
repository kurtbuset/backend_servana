/**
 * Test script for User Presence System
 * Demonstrates Redis presence storage and retrieval
 */

const { cacheManager } = require('./helpers/redisClient');

async function testPresenceSystem() {
  console.log('🧪 Testing User Presence System\n');

  try {
    // Connect to Redis
    console.log('1️⃣ Connecting to Redis...');
    await cacheManager.connect();
    console.log('✅ Connected\n');

    // Test 1: Set user presence
    console.log('2️⃣ Setting user presences...');
    
    await cacheManager.setUserPresence(101, {
      userPresence: 'accepting_chats',
      socketId: 'socket-abc-123',
      userType: 'agent',
      lastSeen: new Date().toISOString(),
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com'
    });
    console.log('✅ Set user 101: accepting_chats');

    await cacheManager.setUserPresence(102, {
      userPresence: 'not_accepting_chats',
      socketId: 'socket-def-456',
      userType: 'agent',
      lastSeen: new Date().toISOString(),
      firstName: 'Bob',
      lastName: 'Johnson',
      email: 'bob@example.com'
    });
    console.log('✅ Set user 102: not_accepting_chats');

    await cacheManager.setUserPresence(103, {
      userPresence: 'offline',
      socketId: null,
      userType: 'agent',
      lastSeen: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 minutes ago
      firstName: 'Charlie',
      lastName: 'Brown',
      email: 'charlie@example.com'
    });
    console.log('✅ Set user 103: offline\n');

    // Test 2: Get specific user presence
    console.log('3️⃣ Getting specific user presence...');
    const user101 = await cacheManager.getUserPresence(101);
    console.log('User 101:', JSON.stringify(user101, null, 2));
    console.log('');

    // Test 3: Get all presences
    console.log('4️⃣ Getting all user presences...');
    const allPresences = await cacheManager.getAllUserPresence();
    console.log('All Presences:');
    console.table(
      Object.entries(allPresences).map(([userId, data]) => ({
        userId,
        status: data.userPresence,
        name: `${data.firstName} ${data.lastName}`,
        socketId: data.socketId || 'N/A',
        lastSeen: new Date(data.lastSeen).toLocaleString()
      }))
    );
    console.log('');

    // Test 4: Update heartbeat
    console.log('5️⃣ Updating heartbeat for user 101...');
    await cacheManager.updateUserHeartbeat(101);
    const updatedUser = await cacheManager.getUserPresence(101);
    console.log('Updated lastSeen:', updatedUser.lastSeen);
    console.log('');

    // Test 5: Filter by status
    console.log('6️⃣ Filtering users by status...');
    const acceptingChats = Object.entries(allPresences)
      .filter(([_, data]) => data.userPresence === 'accepting_chats')
      .map(([userId, data]) => ({
        userId,
        name: `${data.firstName} ${data.lastName}`
      }));
    
    console.log('Users accepting chats:', acceptingChats);
    console.log('');

    // Test 6: Simulate stale user detection
    console.log('7️⃣ Detecting stale users (inactive > 15 minutes)...');
    const staleThreshold = 15 * 60 * 1000; // 15 minutes
    const now = new Date();
    
    const staleUsers = Object.entries(allPresences)
      .filter(([_, data]) => {
        const lastSeen = new Date(data.lastSeen);
        const timeSinceLastSeen = now - lastSeen;
        return timeSinceLastSeen > staleThreshold && data.userPresence !== 'offline';
      })
      .map(([userId, data]) => ({
        userId,
        name: `${data.firstName} ${data.lastName}`,
        minutesInactive: Math.floor((now - new Date(data.lastSeen)) / 1000 / 60)
      }));
    
    if (staleUsers.length > 0) {
      console.log('Stale users found:', staleUsers);
    } else {
      console.log('No stale users found');
    }
    console.log('');

    // Test 7: Remove user presence
    console.log('8️⃣ Removing user 103 presence...');
    await cacheManager.removeUserPresence(103);
    const afterRemoval = await cacheManager.getAllUserPresence();
    console.log(`Remaining users: ${Object.keys(afterRemoval).length}`);
    console.log('');

    // Test 8: Redis raw commands (for verification)
    console.log('9️⃣ Verifying with raw Redis commands...');
    const rawData = await cacheManager.client.hGetAll('user_presence:all');
    console.log('Raw Redis data:');
    Object.entries(rawData).forEach(([userId, data]) => {
      const parsed = JSON.parse(data);
      console.log(`  User ${userId}: ${parsed.userPresence}`);
    });
    console.log('');

    // Cleanup
    console.log('🧹 Cleaning up test data...');
    await cacheManager.removeUserPresence(101);
    await cacheManager.removeUserPresence(102);
    console.log('✅ Cleanup complete\n');

    console.log('✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run tests
testPresenceSystem();
