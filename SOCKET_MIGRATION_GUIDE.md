# Socket Migration Guide: From Complex to Simple

## Overview

This guide helps you migrate from the over-engineered socket structure (15+ files) to a simplified implementation (1 file).

## Current vs Simplified Structure

### Before (Complex)
```
backend_servana/socket/
├── authorization/
├── constants/
├── emitters/
├── events/
├── handlers/
├── helpers/
├── middleware/
├── notifications/
├── security/
├── services/
├── agent-status.manager.js
├── index.js
└── socket.config.js
```

### After (Simple)
```
backend_servana/socket-simple/
├── index.js                  # All socket logic in one file
├── auth.js                   # Simplified auth middleware
└── README.md                 # Documentation
```

## Migration Steps

### Step 1: Test the Simplified Socket

1. **Run the test server:**
   ```bash
   cd backend_servana
   node test-simple-socket.js
   ```

2. **Verify it works:**
   - Visit http://localhost:5001/test
   - Should show "Simplified socket server is running"

### Step 2: Update Main Server (When Ready)

Replace the socket initialization in `index.js`:

```javascript
// OLD (complex)
const { initializeSocket } = require('./socket');

// NEW (simple)
const { initializeSocket } = require('./socket-simple');
```

### Step 3: Update Frontend Clients

The simplified socket uses the same event names, so frontend changes are minimal:

**Events that work exactly the same:**
- `joinChatGroup`
- `sendMessage` 
- `receiveMessage`
- `resolveChat`
- `chatResolved`
- `reactivateChat`
- `chatReactivated`
- `typing` / `stopTyping`

### Step 4: Clean Up (After Testing)

Once everything works, you can delete:
```bash
rm -rf backend_servana/socket/
rm backend_servana/test-simple-socket.js
rm backend_servana/SOCKET_MIGRATION_GUIDE.md
```

## Key Differences

### Authentication
- **Before:** Complex multi-layer auth with separate web/mobile handlers (10+ files)
- **After:** Single auth file with web (cookie) and mobile (JWT) support

### Event Handling
- **Before:** Separate handler files with complex emitter classes
- **After:** Direct `socket.on()` and `io.to().emit()` calls

### Error Handling
- **Before:** Complex error emitter system
- **After:** Simple `socket.emit('error', { message })` 

### Logging
- **Before:** Complex security logging system
- **After:** Simple `console.log` with clear prefixes (✅❌📤📱)

### Room Access Control
- **Before:** Complex authorization middleware
- **After:** Simple `validateRoomAccess()` function for clients

## Event Reference

### Client → Server Events
```javascript
// Join a chat room
socket.emit('joinChatGroup', { chatGroupId: 123 });

// Send a message
socket.emit('sendMessage', { 
  chatGroupId: 123, 
  chat_body: 'Hello world' 
});

// End a chat (agents only)
socket.emit('resolveChat', { chatGroupId: 123 });

// Reactivate a chat (agents only)
socket.emit('reactivateChat', { 
  chatGroupId: 123, 
  deptId: 456  // optional
});

// Typing indicators
socket.emit('typing', { chatGroupId: 123 });
socket.emit('stopTyping', { chatGroupId: 123 });
```

### Server → Client Events
```javascript
// Message received
socket.on('receiveMessage', (message) => {
  // message contains: chat_id, chat_body, chat_created_at, etc.
});

// Chat was resolved
socket.on('chatResolved', (data) => {
  // data contains: chat_group_id, status, system_message, etc.
});

// Chat was reactivated
socket.on('chatReactivated', (data) => {
  // data contains: chat_group_id, status, system_message, etc.
});

// Errors
socket.on('error', (error) => {
  // error contains: { message: 'Error description' }
});
```

## Benefits of Simplified Approach

1. **Readability:** All socket logic in one 200-line file vs 15+ files
2. **Maintainability:** Easy to find and fix issues
3. **Performance:** No unnecessary abstractions or middleware layers
4. **Debugging:** Clear, linear code flow
5. **Onboarding:** New developers can understand it in minutes

## Rollback Plan

If issues arise, simply revert the `index.js` change:
```javascript
// Rollback to complex socket
const { initializeSocket } = require('./socket');
```

The old socket folder remains untouched until you're confident in the new implementation.