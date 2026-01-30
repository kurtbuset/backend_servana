# User Status Tracking System

This guide explains how to implement and use the real-time user status tracking system (online/offline/last seen) similar to Facebook and Instagram.

## Overview

The system tracks user presence in real-time using Socket.IO and displays status indicators throughout the application.

## Features

- ✅ Real-time online/offline status
- ✅ Last seen timestamps ("5m ago", "2h ago", "yesterday")
- ✅ Automatic status updates on connect/disconnect
- ✅ Persistent storage in database
- ✅ Facebook/Instagram-like UI indicators
- ✅ Animated online status dots

## Database Setup

### 1. Run the Migration

Execute the SQL migration to add the `last_seen` column:

```bash
# Using psql
psql -U your_username -d your_database -f backend_servana/migrations/add_last_seen_column.sql

# Or using Supabase SQL Editor
# Copy and paste the contents of add_last_seen_column.sql
```

The migration adds:
- `last_seen` column (TIMESTAMP WITH TIME ZONE)
- Index for performance
- Default value of NOW()

## Backend Implementation

### Socket.IO Events

The backend handles these events:

#### Client → Server Events

1. **userOnline** - User comes online
```javascript
socket.emit('userOnline', {
  userId: 123,
  userType: 'agent',
  userName: 'John Doe'
});
```

2. **userOffline** - User goes offline
```javascript
socket.emit('userOffline', {
  userId: 123
});
```

3. **getOnlineUsers** - Request list of online users
```javascript
socket.emit('getOnlineUsers');
```

#### Server → Client Events

1. **userStatusChanged** - Broadcast when user status changes
```javascript
socket.on('userStatusChanged', ({ userId, status, lastSeen }) => {
  // Update UI
});
```

2. **onlineUsersList** - Response with all online users
```javascript
socket.on('onlineUsersList', (users) => {
  // users = [{ userId, status, lastSeen, userType, userName }]
});
```

### How It Works

1. User connects → Socket.IO connection established
2. Frontend emits `userOnline` event
3. Backend stores user in `onlineUsers` Map
4. Backend updates `last_seen` in database
5. Backend broadcasts `userStatusChanged` to all clients
6. On disconnect → Backend emits `userOffline` and updates database

## Frontend Implementation

### 1. UserContext Integration

The `UserContext` automatically handles status tracking:

```javascript
import { useUser } from '../context/UserContext';

function MyComponent() {
  const { getUserStatus, userStatuses } = useUser();
  
  // Get specific user status
  const status = getUserStatus(userId);
  // { status: 'online', lastSeen: Date }
}
```

### 2. Using the UserStatus Component

Display status anywhere in your app:

```jsx
import UserStatus from '../components/UserStatus';

<UserStatus 
  lastSeen={user.last_seen}
  showDot={true}
  showText={true}
  size="md"
/>
```

**Props:**
- `lastSeen` - Date or ISO string
- `showDot` - Show colored indicator dot (default: true)
- `showText` - Show status text (default: true)
- `size` - 'sm', 'md', 'lg' (default: 'md')
- `className` - Additional CSS classes

### 3. Using Utility Functions

```javascript
import { formatLastSeen, getStatusColor, isUserOnline } from '../utils/timeUtils';

// Format last seen
formatLastSeen(new Date()); // "online"
formatLastSeen(new Date(Date.now() - 300000)); // "5m ago"

// Get status color
getStatusColor(new Date()); // "#10b981" (green)

// Check if online
isUserOnline(new Date()); // true
```

## Usage Examples

### Example 1: User List with Status

```jsx
import { useUser } from '../context/UserContext';
import UserStatus from '../components/UserStatus';

function UserList({ users }) {
  const { getUserStatus } = useUser();
  
  return (
    <div>
      {users.map(user => {
        const status = getUserStatus(user.id);
        
        return (
          <div key={user.id} className="flex items-center gap-3">
            <img src={user.avatar} className="w-10 h-10 rounded-full" />
            <div>
              <h4>{user.name}</h4>
              <UserStatus lastSeen={status.lastSeen} size="sm" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

### Example 2: Chat Header with Status

```jsx
import UserStatus from '../components/UserStatus';

function ChatHeader({ user }) {
  return (
    <div className="flex items-center gap-2">
      <h2>{user.name}</h2>
      <UserStatus 
        lastSeen={user.last_seen}
        showDot={true}
        showText={true}
        size="sm"
      />
    </div>
  );
}
```

### Example 3: Profile Card

```jsx
import { useUser } from '../context/UserContext';
import { isUserOnline } from '../utils/timeUtils';

function ProfileCard({ userId }) {
  const { getUserStatus } = useUser();
  const status = getUserStatus(userId);
  const online = isUserOnline(status.lastSeen);
  
  return (
    <div className="relative">
      <img src={avatar} className="w-20 h-20 rounded-full" />
      <div 
        className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 ${
          online ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
        }`}
      />
    </div>
  );
}
```

## Status Display Logic

### Time Ranges

| Time Elapsed | Display |
|--------------|---------|
| < 30 seconds | "online" |
| < 60 minutes | "Xm ago" |
| < 24 hours | "Xh ago" |
| 1 day | "yesterday" |
| < 7 days | "Xd ago" |
| < 30 days | "Xw ago" |
| > 30 days | Date (e.g., "12/25/2024") |

### Status Colors

| Status | Color | Hex |
|--------|-------|-----|
| Online (< 30s) | Green | #10b981 |
| Recently Active (< 5m) | Amber | #f59e0b |
| Offline | Gray | #6b7280 |

## Testing

### Test User Status

1. Open two browser windows
2. Login as different users
3. Watch status indicators update in real-time
4. Close one window → Status changes to "offline"
5. Wait 5 minutes → Status shows "5m ago"

### Debug Mode

Enable Socket.IO debug logs:

```javascript
// In web_servana/src/socket.js
const socket = io(import.meta.env.VITE_BACKEND_URL, {
  autoConnect: false,
  withCredentials: true,
  debug: true // Add this
});
```

## Performance Considerations

1. **Database Updates**: Last seen is updated only on connect/disconnect, not continuously
2. **Memory**: Online users stored in-memory Map (cleared on server restart)
3. **Broadcasting**: Status changes broadcast to all connected clients
4. **Auto-refresh**: Frontend updates status text every 30 seconds

## Troubleshooting

### Status Not Updating

1. Check Socket.IO connection: `socket.connected`
2. Verify `userOnline` event is emitted
3. Check browser console for errors
4. Verify database has `last_seen` column

### Status Shows "offline" for Online Users

1. Check if `userOnline` event is emitted on login
2. Verify Socket.IO connection is established
3. Check backend logs for connection events

### Database Not Updating

1. Verify Supabase client is configured correctly
2. Check database permissions
3. Review backend error logs

## Future Enhancements

- [ ] Add "typing..." indicator
- [ ] Show "last seen at [specific time]"
- [ ] Privacy settings (hide last seen)
- [ ] Bulk status queries for performance
- [ ] Redis for distributed systems
- [ ] Mobile app integration

## API Reference

### Socket Events

```typescript
// Client → Server
interface UserOnlineEvent {
  userId: number;
  userType: string;
  userName: string;
}

interface UserOfflineEvent {
  userId: number;
}

// Server → Client
interface UserStatusChangedEvent {
  userId: number;
  status: 'online' | 'offline';
  lastSeen: Date;
}

interface OnlineUser {
  userId: number;
  status: 'online';
  lastSeen: Date;
  userType: string;
  userName: string;
}
```

### Utility Functions

```typescript
formatLastSeen(lastSeenDate: Date | string): string
getStatusColor(lastSeenDate: Date | string): string
isUserOnline(lastSeenDate: Date | string): boolean
```

## License

MIT
