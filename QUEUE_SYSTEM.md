# Queue System Implementation

## Overview
The queue system allows new client messages to be held in a queue where agents can preview them before accepting. Once accepted, the agent can communicate with the client.

## Flow Diagram

```
Client sends message
        ↓
Chat Group created (sys_user_id = NULL)
        ↓
Appears in Queue (Pending)
        ↓
Agent previews messages (Read-only)
        ↓
Agent clicks "Accept Chat"
        ↓
Chat assigned to agent (sys_user_id = agent_id)
        ↓
Added to sys_user_chat_group junction table
        ↓
Agent can now send messages
        ↓
Badge counts update via WebSocket
```

## Database States

### **Pending (In Queue)**
```sql
chat_group.sys_user_id = NULL
```
- Chat is waiting for an agent
- Visible in Queues screen
- Messages are read-only (preview mode)
- Shows "Accept Chat" button

### **Accepted (Active)**
```sql
chat_group.sys_user_id = <agent_id>
AND
sys_user_chat_group entry exists
```
- Chat is assigned to an agent
- Agent can send/receive messages
- Shows in Chats screen
- Shows three-dot menu (End Chat, Transfer)

## Frontend Implementation

### **Queues.jsx Changes**

#### 1. **Accept Chat Button**
```jsx
{!selectedCustomer.isAccepted && !selectedCustomer.sys_user_id && !chatEnded && (
  <button onClick={handleAcceptChat}>
    Accept Chat
  </button>
)}
```

#### 2. **Preview Mode Indicator**
- Shows "Waiting in Queue" status
- Displays orange notice: "Preview Mode: Accept this chat to start communicating"
- Input fields are disabled until accepted

#### 3. **Message Input States**
- **Not Accepted**: Disabled, shows placeholder "Accept chat to send messages"
- **Accepted**: Enabled, normal functionality
- **Ended**: Disabled, grayed out

#### 4. **handleAcceptChat Function**
```javascript
const handleAcceptChat = async () => {
  // Call API to accept chat
  const response = await api.post(`/queues/${chatGroupId}/accept`);
  
  // Emit socket event
  socket.emit('acceptChat', { chatGroupId, agentId });
  
  // Update local state
  setSelectedCustomer(prev => ({
    ...prev,
    isAccepted: true,
    sys_user_id: agentId
  }));
};
```

## Backend Implementation

### **New Endpoint: POST /queues/:chatGroupId/accept**

**Purpose:** Assign a pending chat to the current agent

**Request:**
```
POST /queues/123/accept
Headers: { Cookie: access_token }
```

**Process:**
1. Verify chat_group exists and is unassigned
2. Update `chat_group.sys_user_id = agent_id`
3. Insert into `sys_user_chat_group` junction table
4. Return success response

**Response:**
```json
{
  "success": true,
  "message": "Chat accepted successfully",
  "agentId": 5,
  "chatGroupId": 123
}
```

**Error Cases:**
- 404: Chat group not found
- 400: Chat already assigned to another agent
- 500: Database error

### **Socket Events**

#### **Emitted by Client:**
```javascript
socket.emit('acceptChat', { 
  chatGroupId: 123, 
  agentId: 5 
});
```

#### **Handled by Server:**
```javascript
socket.on('acceptChat', async (data) => {
  // Broadcast count updates
  await broadcastChatCounts(io);
  io.emit('chatAccepted', { chatGroupId: data.chatGroupId });
});
```

#### **Received by All Clients:**
```javascript
socket.on('chatAccepted', (data) => {
  // Update badge counts
  // Remove from queue list
  // Refresh active chats
});
```

## UI/UX Features

### **Queue List**
- Shows all pending chats (sys_user_id = NULL)
- Displays client name, number, department
- Shows timestamp of first message
- Click to preview messages

### **Preview Mode**
- **Header**: Shows "Waiting in Queue" status
- **Messages**: Read-only, can scroll through history
- **Accept Button**: Prominent purple button in header
- **Input Area**: Disabled with orange notice banner
- **No Menu**: Three-dot menu hidden until accepted

### **Active Mode (After Accept)**
- **Header**: Normal client info, no queue status
- **Messages**: Full read/write access
- **Input Area**: Enabled, can send messages
- **Menu**: Three-dot menu visible (End Chat, Transfer)
- **Canned Messages**: Available

## Badge Count Updates

### **When Chat is Accepted:**
1. Pending badge decreases by 1
2. Active badge increases by 1
3. Chat removed from Queue list
4. Chat appears in Chats list

### **WebSocket Flow:**
```
Agent clicks Accept
    ↓
API call succeeds
    ↓
socket.emit('acceptChat')
    ↓
Server broadcasts 'chatCountsUpdate'
    ↓
All clients update badges
```

## Testing Checklist

- [X] New client message appears in Queue
- [X] Agent can preview messages (read-only)
- [X] Accept button is visible and clickable
- [ ] After accept, input is enabled
- [ ] After accept, three-dot menu appears
- [ ] Badge counts update correctly
- [ ] Other agents see chat removed from queue
- [ ] Cannot accept already-assigned chat
- [ ] Socket events broadcast properly
- [ ] Transfer department works after accept
- [ ] End chat works after accept

## Future Enhancements

1. **Auto-assignment**: Automatically assign to least-busy agent
2. **Queue timeout**: Alert if chat waits too long
3. **Queue priority**: VIP clients go to front
4. **Agent notifications**: Sound/desktop notification for new chats
5. **Queue statistics**: Average wait time, acceptance rate
6. **Reject option**: Allow agent to reject and send to another department
7. **Preview limit**: Show only first N messages in preview
8. **Typing indicators**: Show when client is typing
9. **Read receipts**: Show when agent has read messages
10. **Queue filters**: Filter by department, wait time, etc.

## Notes

- Only unassigned chats (sys_user_id = NULL) appear in Queue
- Once accepted, chat moves to Chats screen
- Agent can only accept one chat at a time (implement limit if needed)
- Preview mode prevents accidental messages before acceptance
- Socket events ensure real-time updates across all agents
