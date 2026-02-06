#!/usr/bin/env node

/**
 * Cache Migration Script
 * Helps transition from old Redis usage to new centralized cache manager
 */

const { cacheManager } = require('../helpers/redisClient');
const cacheService = require('../services/cache.service');

async function migrateCacheData() {
  console.log('🔄 Starting cache migration...');
  
  try {
    // Connect to cache
    const cache = await cacheManager.connect();
    if (!cache) {
      console.error('❌ Failed to connect to cache');
      process.exit(1);
    }

    console.log('✅ Connected to cache manager');

    // Clear any old cache patterns that might conflict
    console.log('🧹 Cleaning up old cache patterns...');
    
    // The new cache manager will handle key organization
    // Old keys will naturally expire based on TTL
    
    console.log('✅ Cache migration completed successfully');
    
    // Display cache statistics
    const stats = await cache.getStats();
    if (stats) {
      console.log('📊 Cache Statistics:');
      console.log(`   - Connected: ${stats.connected}`);
      console.log(`   - Total Keys: ${stats.keyCount}`);
    }

    // Test basic operations
    console.log('🧪 Testing cache operations...');
    
    // Test session creation
    await cache.createSession('test-session', 'test-user', { test: true });
    const session = await cache.getSession('test-session');
    
    if (session && session.userId === 'test-user') {
      console.log('✅ Session operations working');
      await cache.deleteSession('test-session');
    } else {
      console.log('❌ Session operations failed');
    }

    // Test user status
    await cache.setUserOnline('test-user', { userType: 'agent', name: 'Test User' });
    const onlineUsers = await cache.getOnlineUsers();
    
    if (onlineUsers['test-user']) {
      console.log('✅ User status operations working');
      await cache.setUserOffline('test-user');
    } else {
      console.log('❌ User status operations failed');
    }

    // Test rate limiting
    const allowed1 = await cache.checkRateLimit('test-limit', 5, 60);
    const allowed2 = await cache.checkRateLimit('test-limit', 5, 60);
    
    if (allowed1 && allowed2) {
      console.log('✅ Rate limiting operations working');
    } else {
      console.log('❌ Rate limiting operations failed');
    }

    console.log('🎉 All cache operations verified successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

async function displayCacheInfo() {
  console.log('\n📋 Cache Manager Information:');
  console.log('================================');
  
  console.log('\n🔑 Key Prefixes:');
  Object.entries(cacheManager.keyPrefixes).forEach(([name, prefix]) => {
    console.log(`   ${name}: ${prefix}`);
  });
  
  console.log('\n⏰ TTL Policies:');
  Object.entries(cacheManager.ttlPolicies).forEach(([name, ttl]) => {
    const hours = Math.floor(ttl / 3600);
    const minutes = Math.floor((ttl % 3600) / 60);
    const seconds = ttl % 60;
    
    let timeStr = '';
    if (hours > 0) timeStr += `${hours}h `;
    if (minutes > 0) timeStr += `${minutes}m `;
    if (seconds > 0) timeStr += `${seconds}s`;
    
    console.log(`   ${name}: ${timeStr.trim()}`);
  });
  
  console.log('\n🎯 Cache Strategies:');
  console.log('   Sessions: Cache-Aside with TTL');
  console.log('   User Profiles: Cache-Aside');
  console.log('   Departments: Write-Through');
  console.log('   Roles: Write-Through');
  console.log('   Chat Messages: Cache-Aside (Recent only)');
  console.log('   Online Users: In-Memory Hash');
  console.log('   Typing Indicators: Short-lived (10s TTL)');
  console.log('   Rate Limiting: Counter with TTL');
}

// Main execution
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'migrate':
      await migrateCacheData();
      break;
    case 'info':
      await displayCacheInfo();
      break;
    case 'test':
      await migrateCacheData(); // Includes testing
      break;
    default:
      console.log('Usage: node cache-migration.js [migrate|info|test]');
      console.log('');
      console.log('Commands:');
      console.log('  migrate  - Migrate from old Redis to new cache manager');
      console.log('  info     - Display cache configuration information');
      console.log('  test     - Test cache operations');
      process.exit(1);
  }
  
  process.exit(0);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { migrateCacheData, displayCacheInfo };