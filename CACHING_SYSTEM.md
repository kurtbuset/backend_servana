# Centralized Redis Caching System

## Overview

This document describes the new centralized, structured Redis caching system implemented for the Servana customer support platform. The system replaces scattered Redis usage with a unified cache manager that handles all caching operations efficiently and consistently.

## Architecture

### Cache Manager (`helpers/redisClient.js`)
- **Centralized Connection Management**: Single Redis connection with automatic reconnection
- **Structured Key Organization**: Consistent key prefixes for all data types
- **TTL Policy Management**: Configurable expiration times for different data types
- **Multiple Cache Patterns**: Support for Cache-Aside, Write-Through, and In-Memory operations

### Cache Service (`services/cache.service.js`)
- **Business Logic Layer**: High-level caching operations for application features
- **Database Integration**: Automatic fallback to database on cache misses
- **Bulk Operations**: Efficient multi-key operations and invalidation

## Cache Strategies by Data Type

### 1. Cache-Aside (Lazy Loading)
**Used for**: Sessions, User Profiles, Chat Messages, Canned Messages

```javascript
// Example: User Profile Caching
const profile = await cacheService.getUserProfile(userId);
// Automatically fetches from DB if not in cache
```

**Benefits**:
- Only caches data that's actually requested
- Handles cache misses gracefully
- Good for unpredictable access patterns

### 2. Write-Through
**Used for**: Departments, Roles, System Configuration

```javascript
// Example: Department Updates
await cacheService.updateDepartments(departments);
// Updates database first, then cache
```

**Benefits**:
- Ensures cache consistency
- Critical data always available
- Good for frequently read, rarely updated data

### 3. In-Memory Only
**Used for**: Online Users, Typing Indicators, Real-time Presence

```javascript
// Example: User Status
await cacheService.setUserOnline(userId, userData);
const onlineUsers = await cacheService.getOnlineUsers();
```

**Benefits**:
- Ultra-fast access for real-time features
- No database overhead
- Automatic cleanup on expiration

## Key Organization

All cache keys follow a structured prefix system:

```
session:abc123                    # User sessions
user_profile:456                  # Agent profiles  
client_profile:789                # Client profiles
chat_messages:group_123           # Recent chat messages
department:all                    # All departments
role:all                         # All roles
canned_messages:role_1_user_456   # Filtered canned messages
online_users:active               # Currently online users
user_status:456                   # Individual user status
typing:group_123                  # Typing indicators
rate_limit:user_456               # Rate limiting counters
system_config:feature_flags       # System configuration
```

## TTL Policies

Different data types have optimized expiration times:

| Data Type | TTL | Reason |
|-----------|-----|---------|
| Sessions | 24 hours | User login duration |
| User Profiles | 1 hour | Moderate change frequency |
| Chat Messages | 2 hours | Recent conversation context |
| Departments | 24 hours | Rarely change |
| Roles | 24 hours | Rarely change |
| Online Users | 1 minute | Real-time data |
| User Status | 45 seconds | Heartbeat data |
| Typing | 10 seconds | Very short-lived |
| Rate Limits | 1 hour | Standard rate window |

## Usage Examples

### Session Management
```javascript
const sessionService = require('./services/session.service');
const cache = req.app.get('cache');

// Create session
const sessionId = await sessionService.createSession(cache, userId, userData);

// Get session (auto-updates last accessed)
const session = await sessionService.getSession(cache, sessionId);

// Delete session
await sessionService.deleteSession(cache, sessionId);
```

### User Profile Caching
```javascript
const cacheService = require('./services/cache.service');

// Get user profile (cache-aside)
const profile = await cacheService.getUserProfile(userId, 'agent');

// Invalidate when profile changes
await cacheService.invalidateUserProfile(userId, 'agent');
```

### Real-time Features
```javascript
// Set user online
await cacheService.setUserOnline(userId, {
  userType: 'agent',
  name: 'John Doe',
  department: 'Support'
});

// Get all online users
const onlineUsers = await cacheService.getOnlineUsers();

// Set typing indicator
await cacheService.setTyping(chatGroupId, userId, true);
```

### Rate Limiting
```javascript
// Check rate limit (100 requests per hour)
const allowed = await cacheService.checkRateLimit(
  `user_${userId}`, 
  100, 
  3600
);

if (!allowed) {
  return res.status(429).json({ error: 'Rate limit exceeded' });
}
```

## Performance Benefits

### Before (Scattered Redis Usage)
- Multiple Redis connections
- Inconsistent key naming
- Manual TTL management
- No centralized invalidation
- Mixed caching patterns

### After (Centralized Cache Manager)
- Single Redis connection
- Structured key organization
- Automatic TTL policies
- Centralized cache operations
- Optimized caching strategies

### Expected Improvements
- **60-80% reduction** in database queries
- **50% faster** response times for cached operations
- **Consistent** cache behavior across all features
- **Easier** cache debugging and monitoring
- **Better** memory utilization

## Monitoring and Debugging

### Cache Statistics
```javascript
const stats = await cacheService.getCacheStats();
console.log('Cache Stats:', stats);
```

### Health Check
```javascript
const healthy = await cacheService.healthCheck();
if (!healthy) {
  console.log('Cache is down, falling back to database');
}
```

### Cache Cleanup
```javascript
// Manual cleanup (also runs automatically every 5 minutes)
await cacheService.cleanup();
```

## Migration Guide

### 1. Update Controllers
Replace direct Redis client usage:
```javascript
// Old
const redisClient = req.app.get('redis');
await redisClient.setEx(key, ttl, JSON.stringify(data));

// New  
const cache = req.app.get('cache');
await cache.set('PREFIX', identifier, data);
```

### 2. Update Services
Use cache service for business logic:
```javascript
// Old
const data = await redisClient.get(key);
if (!data) {
  // Manual database fallback
}

// New
const data = await cacheService.getUserProfile(userId);
// Automatic database fallback
```

### 3. Run Migration Script
```bash
node scripts/cache-migration.js migrate
```

## Configuration

### Environment Variables
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password
```

### TTL Customization
Modify `ttlPolicies` in `helpers/redisClient.js`:
```javascript
this.ttlPolicies = {
  SESSION: 24 * 60 * 60,     // 24 hours
  USER_PROFILE: 60 * 60,     // 1 hour
  // ... other policies
};
```

## Best Practices

### 1. Use Appropriate Cache Strategy
- **Cache-Aside**: For unpredictable access patterns
- **Write-Through**: For critical, frequently-read data
- **In-Memory**: For real-time, short-lived data

### 2. Handle Cache Failures Gracefully
```javascript
const data = await cacheService.getUserProfile(userId);
if (!data) {
  // Cache miss or failure - data fetched from DB automatically
  console.log('Cache miss, served from database');
}
```

### 3. Invalidate Appropriately
```javascript
// After updating user profile
await cacheService.invalidateUserProfile(userId);

// After department changes
await cacheService.invalidateAllDepartmentData();
```

### 4. Monitor Cache Performance
```javascript
// Log cache hit/miss ratios
const stats = await cacheService.getCacheStats();
console.log(`Cache efficiency: ${stats.hitRatio}%`);
```

## Troubleshooting

### Common Issues

1. **Cache Connection Failed**
   - Check Redis server status
   - Verify connection credentials
   - Application continues without cache

2. **High Memory Usage**
   - Review TTL policies
   - Check for memory leaks in cached data
   - Monitor key count growth

3. **Cache Inconsistency**
   - Use write-through for critical data
   - Implement proper invalidation
   - Consider cache warming strategies

### Debug Commands
```bash
# Test cache operations
node scripts/cache-migration.js test

# View cache configuration
node scripts/cache-migration.js info

# Monitor Redis directly
redis-cli monitor
```

## Future Enhancements

1. **Cache Warming**: Pre-populate cache with frequently accessed data
2. **Distributed Caching**: Support for Redis Cluster
3. **Cache Analytics**: Detailed hit/miss ratio tracking
4. **Automatic Scaling**: Dynamic TTL adjustment based on usage patterns
5. **Cache Compression**: Reduce memory usage for large objects

## Conclusion

The new centralized caching system provides a robust, scalable foundation for the Servana platform. It eliminates redundancy, improves performance, and makes cache management much more maintainable. The structured approach ensures consistent behavior across all application features while providing the flexibility to optimize for different data access patterns.