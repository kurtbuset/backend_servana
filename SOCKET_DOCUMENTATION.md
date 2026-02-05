# Servana Backend Socket.IO Documentation

## Overview

The Servana Backend implements real-time communication using Socket.IO for live chat functionality, user status management, and real-time updates. It supports both web and mobile clients with comprehensive authentication, authorization, and security features.

## Connection URL
- **Development:** `ws://localhost:3000`
- **Production:** `wss://[your-domain]`

## Authentication

### Web Clients
Connect with HTTP-only cookies containing Supabase access tokens:
```javascript
const socket = io('http://localhost:3000', {
  withCredentials: true // Sends cookies automatically
});
```

### Mobile Clients
Connect with JWT Bearer token in headers:
```javascript
const socket = io('http://localhost:3000', {
  extraHeaders: {
    'Authorization': 'Bearer your_jwt_token_here'
  }
});
```

## Connection Flow

1. **Client initiates connection**
2. **Authentication middleware validates credentials**
3. **User context attached to socket**
4. **Connection established**
5. **User can join rooms and send events**

---

## User Status Events

### Client → Server Events

#### `userOnline`
Mark user as online and join appropriate rooms.

**Payload:**
```javascript
socket.emit('userOnline', {
  userId: 123,
  userType: 'agent' // or 'client'
});
```

**Response Events:**
- `userStatusUpdated` - Confirmation of online status
- `onlineUsersUpdate` - Updated list of online users

#### `userHeartbeat`
Keep-alive signal to maintain online status.

**Payload:**
```javascript
socket.emit('userHeartbeat', {
  userId: 123,
  timestamp: Date.now()
});
```

**Rate Limit:** 10 updates per minute per user

#### `userOffline`
Mark user as offline.

**Payload:**
```javascript
socket.emit('userOffline', {
  userId: 123
});
```

#### `getOnlineUsers`
Request current list of online users.

**Payload:**
```javascript
socket.emit('getOnlineUsers');
```

**Response:**
```javascript
socket.on('onlineUsersList', (users) => {
  console.log('Online users:', users);
  // users = [{ userId: 123, userType: 'agent', lastSeen: '2024-01-15T10:30:00Z' }]
});
```

### Server → Client Events

#### `userStatusUpdated`
Confirmation of status change.

**Payload:**
```javascript
{
  userId: 123,
  status: 'online',
  timestamp: '2024-01-15T10:30:00Z'
}
```

#### `onlineUsersUpdate`
Real-time update of online users list.

**Payload:**
```javascript
{
  onlineUsers: [
    {
      userId: 123,
      userType: 'agent',
      lastSeen: '2024-01-15T10:30:00Z'
    }
  ]
}
```

#### `userJoined`
Notification when user joins a room.

**Payload:**
```javascript
{
  userType: 'agent',
  userId: 123,
  chatGroupId: 456
}
```

#### `userLeft`
Notification when user leaves a room.

**Payload:**
```javascript
{
  userType: 'agent',
  userId: 123,
  chatGroupId: 456
}
```

---

## Chat Events

### Client → Server Events

#### `joinChatGroup`
Join a specific chat room.

**Payload:**
```javascript
socket.emit('joinChatGroup', {
  groupId: 456,
  userType: 'agent',
  userId: 123
});
```

**Authorization:**
- **Clients:** Can only join their own chat groups
- **Agents:** Can join assigned chats, department chats, or any chat (if admin)

**Response Events:**
- `joinedRoom` - Success confirmation
- `error` - If access denied

#### `leaveRoom`
Leave current chat room.

**Payload:**
```javascript
socket.emit('leaveRoom', {
  chatGroupId: 456
});
```

#### `sendMessage`
Send a message to the current chat room.

**Payload:**
```javascript
socket.emit('sendMessage', {
  message: 'Hello, how can I help you?',
  chatGroupId: 456,
  clientId: 789 // Required for proper message routing
});
```

**Rate Limit:** 30 messages per minute per user

**Validation:**
- Message content sanitized for XSS
- User must be in the chat room
- Chat room must be active

#### `typing`
Indicate user is typing.

**Payload:**
```javascript
socket.emit('typing', {
  chatGroupId: 456,
  userType: 'agent',
  userId: 123
});
```

#### `stopTyping`
Indicate user stopped typing.

**Payload:**
```javascript
socket.emit('stopTyping', {
  chatGroupId: 456,
  userType: 'agent',
  userId: 123
});
```

### Server → Client Events

#### `joinedRoom`
Confirmation of successful room join.

**Payload:**
```javascript
{
  chatGroupId: 456,
  roomInfo: {
    status: 'active',
    memberCount: 2
  }
}
```

#### `receiveMessage`
New message received in chat room.

**Payload:**
```javascript
{
  chat_id: 789,
  chat_message: 'Hello, how can I help you?',
  chat_created_at: '2024-01-15T10:30:00Z',
  sender_type: 'agent',
  chatGroupId: 456,
  sender: {
    userId: 123,
    profile: {
      prof_firstname: 'John',
      prof_lastname: 'Doe'
    }
  }
}
```

#### `updateChatGroups`
Notification to refresh chat groups list.

**Payload:**
```javascript
{
  action: 'new_message',
  chatGroupId: 456,
  timestamp: '2024-01-15T10:30:00Z'
}
```

#### `typing`
User typing notification.

**Payload:**
```javascript
{
  chatGroupId: 456,
  userType: 'agent',
  userId: 123,
  isTyping: true
}
```

#### `stopTyping`
User stopped typing notification.

**Payload:**
```javascript
{
  chatGroupId: 456,
  userType: 'agent',
  userId: 123,
  isTyping: false
}
```

---

## Real-time Updates

### `customerListUpdate`
Real-time customer list sorting and updates.

**Server → Client:**
```javascript
{
  action: 'sort',
  chatGroupId: 456,
  newPosition: 1,
  timestamp: '2024-01-15T10:30:00Z'
}
```

### `roomStatsUpdate`
Real-time room statistics (admin only).

**Server → Client:**
```javascript
{
  totalRooms: 15,
  activeRooms: 8,
  totalUsers: 25,
  timestamp: '2024-01-15T10:30:00Z'
}
```

---

## Error Events

### `error`
General error notification.

**Payload:**
```javascript
{
  message: 'Authentication required',
  code: 'AUTH_REQUIRED',
  details: 'Additional error details'
}
```

### Common Error Codes
- `AUTH_REQUIRED` - Authentication needed
- `ACCESS_DENIED` - Insufficient permissions
- `ROOM_NOT_FOUND` - Chat room doesn't exist
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `INVALID_DATA` - Malformed request data
- `USER_NOT_FOUND` - User doesn't exist
- `ROOM_INACTIVE` - Chat room is closed/ended

---

## Room Management

### Room Types
1. **Chat Rooms** - Individual chat conversations (format: `chatGroupId`)
2. **Department Rooms** - Department-wide broadcasts (format: `dept_${deptId}`)
3. **User Rooms** - User-specific notifications (format: `user_${userId}`)

### Room Access Control

#### Clients
- Can only join their own chat rooms
- Automatically joined to their user room
- Cannot access department rooms

#### Agents
- Can join assigned chat rooms
- Can join department rooms for their departments
- Can join any chat room if admin privileges
- Automatically joined to department rooms on connection

#### Admins
- Full access to all rooms
- Can monitor room statistics
- Can force user disconnections

---

## Security Features

### Authentication
- Token validation on connection
- User context verification
- Session management with heartbeat
- Automatic token refresh (web clients)

### Authorization
- Room-level access control
- Message sending permissions
- User type validation
- Department-based restrictions

### Rate Limiting
- Message sending: 30/minute per user
- Status updates: 10/minute per user
- Typing events: No limit (short-lived)
- Connection attempts: Monitored and logged

### Data Validation
- Message content sanitization
- XSS prevention
- Input validation for all events
- User identity verification

### Security Logging
- Authentication attempts
- Failed authorization
- Rate limit violations
- Suspicious activity patterns

---

## Client Implementation Examples

### Basic Connection (Web)
```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000', {
  withCredentials: true,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('Connected:', socket.id);
  
  // Mark user as online
  socket.emit('userOnline', {
    userId: currentUser.id,
    userType: 'agent'
  });
});

socket.on('disconnect', () => {
  console.log('Disconnected');
});
```

### Chat Implementation
```javascript
// Join a chat room
socket.emit('joinChatGroup', {
  groupId: chatGroupId,
  userType: 'agent',
  userId: currentUser.id
});

// Listen for room join confirmation
socket.on('joinedRoom', (data) => {
  console.log('Joined room:', data.chatGroupId);
});

// Send a message
const sendMessage = (message) => {
  socket.emit('sendMessage', {
    message: message,
    chatGroupId: currentChatGroup,
    clientId: currentClient.id
  });
};

// Listen for new messages
socket.on('receiveMessage', (messageData) => {
  addMessageToChat(messageData);
});

// Handle typing indicators
const handleTyping = () => {
  socket.emit('typing', {
    chatGroupId: currentChatGroup,
    userType: 'agent',
    userId: currentUser.id
  });
};

socket.on('typing', (data) => {
  showTypingIndicator(data);
});
```

### Mobile Implementation (React Native)
```javascript
import io from 'socket.io-client';

const connectSocket = (token) => {
  const socket = io('http://localhost:3000', {
    extraHeaders: {
      'Authorization': `Bearer ${token}`
    },
    transports: ['websocket']
  });

  socket.on('connect', () => {
    console.log('Mobile client connected');
    
    socket.emit('userOnline', {
      userId: clientId,
      userType: 'client'
    });
  });

  return socket;
};
```

### Error Handling
```javascript
socket.on('error', (error) => {
  console.error('Socket error:', error);
  
  switch (error.code) {
    case 'AUTH_REQUIRED':
      // Redirect to login
      redirectToLogin();
      break;
    case 'ACCESS_DENIED':
      // Show access denied message
      showErrorMessage('Access denied to this chat room');
      break;
    case 'RATE_LIMIT_EXCEEDED':
      // Show rate limit warning
      showWarning('Please slow down your messages');
      break;
    default:
      showErrorMessage(error.message);
  }
});
```

---

## Performance Considerations

### Connection Management
- Automatic reconnection on disconnect
- Heartbeat mechanism for connection health
- Graceful degradation on network issues

### Memory Management
- User status cleanup for stale connections
- Room cleanup when empty
- Rate limit data cleanup

### Scalability
- Room-based message broadcasting
- Efficient user lookup with caching
- Optimized database queries for real-time data

---

## Monitoring and Debugging

### Connection Monitoring
```javascript
// Server-side monitoring
io.engine.on('connection_error', (err) => {
  console.log('Connection error:', err.req, err.code, err.message, err.context);
});

// Client-side debugging
socket.on('connect_error', (error) => {
  console.log('Connection failed:', error.message);
});
```

### Room Statistics
```javascript
// Get room information (admin only)
socket.emit('getRoomStats');

socket.on('roomStatsUpdate', (stats) => {
  console.log('Room stats:', stats);
});
```

### User Status Monitoring
```javascript
// Monitor online users
socket.on('onlineUsersUpdate', (users) => {
  updateOnlineUsersList(users);
});
```

---

## Troubleshooting

### Common Issues

1. **Connection Fails**
   - Check authentication credentials
   - Verify CORS settings
   - Check network connectivity

2. **Can't Join Room**
   - Verify user permissions
   - Check room exists and is active
   - Ensure proper authentication

3. **Messages Not Received**
   - Check if user is in correct room
   - Verify message format
   - Check rate limiting

4. **Typing Indicators Not Working**
   - Ensure proper room membership
   - Check event payload format
   - Verify user permissions

### Debug Mode
Enable debug logging:
```javascript
localStorage.debug = 'socket.io-client:socket';
```

---

## Development Notes

### Environment Setup
```env
SOCKET_DEBUG=true
SOCKET_CORS_ORIGINS=http://localhost:5173,http://localhost:5000
SOCKET_HEARTBEAT_INTERVAL=25000
SOCKET_HEARTBEAT_TIMEOUT=60000
```

### Testing
- Use Socket.IO client for testing connections
- Test authentication with different user types
- Verify rate limiting behavior
- Test room access controls

### Production Considerations
- Enable sticky sessions for load balancing
- Configure proper CORS origins
- Set up SSL/TLS for secure connections
- Monitor connection metrics
- Implement proper logging and alerting

---

## Support

For Socket.IO implementation support or questions, please refer to the backend architecture documentation or contact the development team.