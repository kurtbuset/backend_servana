# Servana Database Schema

## Core Tables

### 1. **sys_user** (System Users - Admins & Agents)
```
├── sys_user_id (PK)
├── supabase_user_id (FK → Supabase Auth)
├── sys_user_email
├── role_id (FK → role)
│   ├── 1 = Admin
│   ├── 2 = Client (not used in sys_user)
│   └── 3 = Agent
├── prof_id (FK → profile)
└── sys_user_is_active
```

### 2. **client** (Mobile App Users)
```
├── client_id (PK)
├── client_number (phone number)
├── client_country_code
├── client_password (hashed)
└── prof_id (FK → profile)
```

### 3. **chat_group** (Conversation Container)
```
├── chat_group_id (PK)
├── client_id (FK → client) - Who started the chat
├── dept_id (FK → department) - Which department
├── sys_user_id (FK → sys_user, nullable) - Assigned agent (if any)
└── chat_group_name
```
**States:**
- `sys_user_id = NULL` → **Pending** (in queue, waiting for agent)
- `sys_user_id = <agent_id>` → **Assigned** (agent accepted)

### 4. **sys_user_chat_group** (Junction Table)
```
├── id (PK)
├── sys_user_id (FK → sys_user)
└── chat_group_id (FK → chat_group)
```
**Purpose:** Tracks which agents are assigned to which chat groups.
- Used for agent's active chat count
- Allows multiple agents per chat group (if needed)

### 5. **chat** (Individual Messages)
```
├── chat_id (PK)
├── chat_group_id (FK → chat_group)
├── client_id (FK → client, nullable) - If message from client
├── sys_user_id (FK → sys_user, nullable) - If message from agent
├── chat_body (message content)
└── chat_created_at
```
**Message Types:**
- `client_id` set, `sys_user_id` NULL → Client message
- `sys_user_id` set, `client_id` NULL → Agent message

### 6. **profile** (User Profile Info)
```
├── prof_id (PK)
├── prof_firstname
├── prof_lastname
├── prof_address
└── prof_date_of_birth
```
**Used by:** Both `sys_user` and `client`

### 7. **image** (Profile Pictures)
```
├── img_id (PK)
├── prof_id (FK → profile)
├── img_location (URL to Supabase Storage)
└── img_is_current (boolean)
```

### 8. **department**
```
├── dept_id (PK)
├── dept_name
└── dept_is_active
```

### 9. **sys_user_department** (Junction Table)
```
├── sys_user_id (FK → sys_user)
└── dept_id (FK → department)
```
**Purpose:** Agents can belong to multiple departments

---

## Chat Flow

### **1. Client Initiates Chat (Mobile App)**
```sql
-- Create chat_group
INSERT INTO chat_group (client_id, dept_id, sys_user_id, chat_group_name)
VALUES (client_id, selected_dept_id, NULL, 'Chat with Support');

-- Send first message
INSERT INTO chat (chat_group_id, client_id, chat_body, chat_created_at)
VALUES (new_chat_group_id, client_id, 'Hello, I need help', NOW());
```
**Socket Event:** `io.emit('newChatInQueue', { chatGroupId })`

### **2. Agent Accepts Chat (Web App)**
```sql
-- Assign agent to chat_group
UPDATE chat_group 
SET sys_user_id = agent_id 
WHERE chat_group_id = selected_chat_id;

-- Add to junction table
INSERT INTO sys_user_chat_group (sys_user_id, chat_group_id)
VALUES (agent_id, selected_chat_id);
```
**Socket Event:** `io.emit('chatAccepted', { chatGroupId })`

### **3. Agent Sends Message**
```sql
INSERT INTO chat (chat_group_id, sys_user_id, chat_body, chat_created_at)
VALUES (chat_group_id, agent_id, 'How can I help you?', NOW());
```
**Socket Event:** `io.to(chatGroupId).emit('newMessage', { message })`

### **4. Client Views Messages**
```sql
-- Mark messages as read (if you have a read status field)
-- Or just track last_seen timestamp
```
**Socket Event:** `socket.emit('markMessagesSeen', { chatGroupId })`

### **5. Chat Closed/Resolved**
```sql
-- Option 1: Soft delete (add chat_group_is_active field)
UPDATE chat_group 
SET chat_group_is_active = false 
WHERE chat_group_id = chat_id;

-- Option 2: Remove from junction table
DELETE FROM sys_user_chat_group 
WHERE chat_group_id = chat_id;
```
**Socket Event:** `io.emit('chatClosed', { chatGroupId })`

---

## Badge Count Queries

### **Pending Chats (Queue)**
```sql
SELECT COUNT(*) FROM chat_group 
WHERE sys_user_id IS NULL;
```

### **Active Chats (Admin - All)**
```sql
SELECT COUNT(*) FROM sys_user_chat_group;
```

### **Active Chats (Agent - Personal)**
```sql
SELECT COUNT(*) FROM sys_user_chat_group 
WHERE sys_user_id = agent_id;
```

---

## Real-Time Updates

### **Socket Events Emitted by Backend:**
- `chatCountsUpdate` - Full count refresh
- `newChatInQueue` - New chat waiting in queue
- `chatAccepted` - Chat assigned to agent
- `chatClosed` - Chat resolved/closed
- `messagesSeen` - Messages marked as read
- `newMessage` - New message in chat

### **Socket Events Received by Backend:**
- `acceptChat` - Agent accepts a pending chat
- `closeChat` - Agent closes a chat
- `markMessagesSeen` - User viewed messages
- `newChat` - Client creates new chat
- `sendMessage` - Send a message

---

## API Endpoints

### **Chat Counts**
```
GET /chat/counts
Response: { pendingChats: 8, activeChats: 23 }
```

### **Get Pending Chats (Queue)**
```
GET /queues
Response: [{ chat_group_id, client_name, dept_name, created_at }]
```

### **Get Active Chats**
```
GET /chats
Response: [{ chat_group_id, client_name, last_message, unread_count }]
```

### **Get Chat Messages**
```
GET /chat/:chatGroupId/messages
Response: [{ chat_id, sender, message, timestamp }]
```

### **Send Message**
```
POST /chat/:chatGroupId/message
Body: { message: "Hello" }
```

---

## Notes

- **Junction Table Usage:** `sys_user_chat_group` is the source of truth for active chats
- **Pending vs Active:** Determined by presence in junction table
- **Message Ownership:** Either `client_id` OR `sys_user_id` is set, never both
- **Real-time:** All state changes should emit socket events
- **Badge Counts:** Update via WebSocket, not polling
