# Simplified Socket Implementation

This folder contains a streamlined Socket.IO implementation that replaces the complex 15+ file structure with just 4 essential files.

## Files

- **`index.js`** - Main socket server with event handlers
- **`auth.js`** - Authentication middleware for web (cookies) and mobile (JWT)
- **`connection.js`** - Connection lifecycle management (connect/disconnect/handshake)
- **`customer-list.js`** - Customer list updates for agent interfaces
- **`agent-status.js`** - Agent status management (online/offline/accepting chats)

## Usage

```javascript
// In your main server file
const { initializeSocket } = require('./socket-simple');

const io = initializeSocket(server, allowedOrigins);

// Get connection statistics
console.log('Connection stats:', io.getStats());
```

## Supported Events

### Client → Server
- `joinChatGroup` - Join a chat room (with access control)
- `leaveChatGroup` - Leave a chat room  
- `leavePreviousRoom` - Leave previous room explicitly
- `sendMessage` - Send a message (with delivery confirmation)
- `resolveChat` - End a chat (agents only)
- `reactivateChat` - Reactivate a resolved chat (agents only)
- `typing` / `stopTyping` - Typing indicators
- `agentOnline` - Agent comes online (agents only)
- `agentHeartbeat` - Agent heartbeat (agents only)
- `updateAgentStatus` - Update agent status (agents only)
- `getAgentStatuses` - Get all agent statuses (agents only)
- `agentOffline` - Agent goes offline (agents only)

### Server → Client
- `receiveMessage` - New message received
- `messageDelivered` - Message delivery confirmation
- `chatResolved` - Chat was ended
- `chatReactivated` - Chat was reactivated
- `customerListUpdate` - Agent customer list updates
- `agentStatusChanged` - Agent status changed
- `agentStatusesList` - List of agent statuses
- `agentStatusUpdateSuccess` - Status update successful
- `agentStatusError` - Agent status error
- `agentHeartbeatAck` - Heartbeat acknowledgment
- `userJoined` / `userLeft` - Room join/leave notifications
- `typing` / `stopTyping` - Typing indicators
- `joinedRoom` - Successfully joined room
- `error` - Error occurred

## Agent Status Management

The `agentStatusChanged` event keeps agent interfaces synchronized:

**Agent Status Types:**
- `accepting_chats` - Agent is online and accepting new chats
- `not_accepting_chats` - Agent is online but not accepting new chats  
- `offline` - Agent is disconnected

**Features:**
- ✅ **Heartbeat system** - Keeps agents alive with rate limiting
- ✅ **Idle detection** - Auto-offline after 12 minutes of inactivity
- ✅ **Department filtering** - Only broadcast to agents in same departments
- ✅ **Database persistence** - Status stored in database
- ✅ **Queue assignment** - Auto-assign queued chats when agent becomes available

## Customer List Updates

The `customerListUpdate` event keeps agent interfaces synchronized:

**Update Types:**
- `move_to_top` - Client sent message, move to top of list
- `chat_resolved` - Remove chat from active list
- `chat_reactivated` - Add chat back to active list
- `new_assignment` - New chat assigned to agent
- `chat_transferred_in/out` - Chat transferred between departments

## Authentication

Supports both web and mobile clients:

- **Web clients**: Supabase tokens via HTTP-only cookies
- **Mobile clients**: JWT tokens via Authorization header

## Benefits

- **Simple**: 7 files vs 15+ files
- **Complete**: 100% feature parity with original complex system
- **Organized**: Separated concerns (auth, connection, events, customer lists)
- **Readable**: Linear code flow, no abstractions
- **Maintainable**: Easy to debug and modify
- **Secure**: Proper authentication and room access control
- **Complete**: All original functionality preserved including customer list updates
- **Monitorable**: Built-in connection statistics and logging

## Migration

To switch from the complex socket implementation:

1. Update your server to use `require('./socket-simple')`
2. Test with existing clients (no frontend changes needed)
3. Remove old `socket/` folder when confident