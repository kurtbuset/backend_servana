# Servana Backend - Architecture Flowchart

## 🏗️ System Overview

This backend is a **Node.js/Express** application with **Supabase** as the database and authentication provider. It supports both **Web Dashboard** (for agents/admins) and **Mobile App** (for clients) with different authentication mechanisms.

---

## 📊 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Express Server (index.js)                 │
│  - Port: 3000 (or process.env.PORT)                         │
│  - CORS: http://localhost:5173                              │
│  - Middleware: JSON, Cookie Parser, Static Files            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ├─────────────────┬─────────────────┐
                            │                 │                 │
                    ┌───────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
                    │   Supabase   │  │  Socket.IO  │  │   Routes    │
                    │   Database   │  │  (Real-time)│  │  (REST API) │
                    └──────────────┘  └─────────────┘  └─────────────┘
```

---

## 🔐 Authentication Systems

### **System 1: Web Dashboard (Agents/Admins) - Supabase Auth + Cookies**

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Authentication Flow                    │
└─────────────────────────────────────────────────────────────┘

Client Request
    │
    ▼
POST /auth/login
    │
    ├─► Supabase Auth.signInWithPassword()
    │   └─► Returns: session (access_token, refresh_token)
    │
    ├─► Set HTTP-only Cookies:
    │   ├─► access_token (1 day expiry)
    │   └─► refresh_token (30 days expiry)
    │
    ├─► Query system_user table
    │   └─► Link: supabase_user_id → sys_user_id
    │
    └─► Response: { sys_user_id, role_id }

Protected Routes
    │
    ▼
Middleware: getCurrentUser
    │
    ├─► Extract: req.cookies.access_token
    │
    ├─► Supabase Auth.getUser(token)
    │   └─► Validates token
    │
    ├─► Query system_user
    │   └─► Map: supabase_user_id → sys_user_id
    │
    └─► Attach: req.userId = sys_user_id
```

**Files:**
- `routes/auth.js` - Login/logout endpoints
- `middleware/getCurrentUser.js` - Cookie-based auth middleware
- `helpers/supabaseClient.js` - Supabase client (anon key)

---

### **System 2: Mobile App (Clients) - JWT Bearer Tokens**

```
┌─────────────────────────────────────────────────────────────┐
│                  Mobile Authentication Flow                   │
└─────────────────────────────────────────────────────────────┘

Client Registration
    │
    ▼
POST /clientAccount/registercl
    │
    ├─► Hash password (bcrypt)
    │
    ├─► Insert into client table
    │
    └─► Generate JWT token
        └─► Payload: { client_id, client_number }
        └─► Expiry: 7 days

Client Login
    │
    ▼
POST /clientAccount/logincl
    │
    ├─► Verify client_number + password
    │
    ├─► Check/create chat_group
    │
    └─► Return JWT token + chat_group_id

Protected Routes
    │
    ▼
Middleware: getCurrentMobileUser
    │
    ├─► Extract: Authorization: Bearer <token>
    │
    ├─► JWT.verify(token, JWT_ACCESS_SECRET)
    │
    └─► Attach: req.userId = decoded.client_id
```

**Files:**
- `routes/mobile/clientAccount.js` - Client registration/login
- `middleware/getCurrentMobileUser.js` - JWT-based auth middleware

---

## 🛣️ Route Structure

### **Web Dashboard Routes** (Cookie-based Auth)

```
/auth
├── POST /login          → Supabase Auth login
├── GET  /me             → Check authentication status
├── GET  /user-id        → Get sys_user_id
└── POST /logout         → Clear cookies

/profile
├── GET  /               → Get current user profile
├── PUT  /               → Update profile
└── POST /image          → Upload profile image

/departments
├── GET  /               → List all departments
├── POST /               → Create department
├── PUT  /:id            → Update department
└── PUT  /:id/toggle     → Toggle active status

/chat
├── GET  /chatgroups     → Get user's chat groups
├── GET  /canned-messages → Get canned messages
└── GET  /:clientId      → Get messages for client

/manage-agents
├── GET  /agents         → List all agents
├── POST /agents         → Create new agent
└── PUT  /agents/:id     → Update agent

/queues
└── GET  /chatgroups     → Get unassigned chat groups

/admins, /auto-replies, /agents, /clients, /change-role, /roles
```

### **Mobile App Routes** (JWT Bearer Token Auth)

```
/clientAccount
├── POST /registercl                    → Register new client
├── POST /logincl                       → Client login
└── PATCH /chat_group/:id/set-department → Assign department

/department
└── GET  /active                        → Get active departments (public)

/messages
├── POST /                              → Send message
├── GET  /group/:id                     → Get messages by group
├── GET  /latest                        → Get latest chat group
└── POST /group/create                  → Create chat group

/agent
└── GET  /:chatGroupId                  → Get agent info for chat group
```

---

## 💬 Real-Time Chat System (Socket.IO)

```
┌─────────────────────────────────────────────────────────────┐
│                    Socket.IO Flow                             │
└─────────────────────────────────────────────────────────────┘

Client Connection
    │
    ▼
io.on('connection')
    │
    ├─► socket.on('joinChatGroup', groupId)
    │   └─► socket.join(groupId)
    │
    └─► socket.on('sendMessage', message)
        │
        ├─► Extract token from cookies
        │
        ├─► Validate via Supabase Auth
        │
        ├─► Map to sys_user_id
        │
        ├─► Insert into chat table
        │
        ├─► io.emit('updateChatGroups')  → Refresh all clients
        │
        └─► io.to(groupId).emit('receiveMessage', data)
            └─► Broadcast to specific chat group
```

**Files:**
- `index.js` - Socket.IO server setup
- `routes/chat.js` - `handleSendMessage` function

---

## 🗄️ Database Schema (Supabase)

### **Key Tables:**

```
sys_user
├── sys_user_id (PK)
├── supabase_user_id (FK → Supabase Auth)
├── sys_user_email
├── role_id
├── prof_id (FK → profile)
└── sys_user_is_active

client
├── client_id (PK)
├── client_number
├── client_country_code
├── client_password (hashed)
└── prof_id (FK → profile)

chat_group
├── chat_group_id (PK)
├── client_id (FK → client)
├── dept_id (FK → department)
├── sys_user_id (FK → system_user, nullable)
└── chat_group_name

chat
├── chat_id (PK)
├── chat_group_id (FK → chat_group)
├── client_id (FK → client, nullable)
├── sys_user_id (FK → system_user, nullable)
├── chat_body
└── chat_created_at

sys_user_chat_group (Junction Table)
├── id (PK)
├── sys_user_id (FK → system_user)
└── chat_group_id (FK → chat_group)

profile
├── prof_id (PK)
├── prof_firstname
├── prof_lastname
├── prof_address
└── prof_date_of_birth

image
├── img_id (PK)
├── prof_id (FK → profile)
├── img_location (URL)
└── img_is_current (boolean)

department
├── dept_id (PK)
├── dept_name
└── dept_is_active

sys_user_department (Junction Table)
├── sys_user_id (FK → system_user)
└── dept_id (FK → department)
```

---

## 🔄 Request Flow Examples

### **Example 1: Agent Views Chat Groups**

```
1. Client → GET /chat/chatgroups
   │
   ├─► Middleware: getCurrentUser
   │   ├─► Extract cookie: access_token
   │   ├─► Supabase Auth.getUser(token)
   │   └─► Query system_user → req.userId
   │
   ├─► Query chat_group
   │   ├─► Join: sys_user_chat_group
   │   ├─► Filter: sys_user_id = req.userId
   │   ├─► Join: client → profile
   │   └─► Join: department
   │
   ├─► Query image table (for profile pictures)
   │
   └─► Response: Formatted chat groups with client info
```

### **Example 2: Client Sends Message (Mobile)**

```
1. Client → POST /messages
   │
   ├─► Middleware: getCurrentMobileUser
   │   ├─► Extract: Authorization header
   │   ├─► JWT.verify(token)
   │   └─► req.userId = decoded.client_id
   │
   ├─► Insert into chat table
   │   ├── chat_body
   │   ├── client_id = req.userId
   │   └── chat_group_id
   │
   └─► Response: Created message
```

### **Example 3: Real-Time Message (Web Dashboard)**

```
1. Client → Socket.IO: sendMessage event
   │
   ├─► handleSendMessage()
   │   ├─► Extract token from socket cookies
   │   ├─► Supabase Auth.getUser(token)
   │   ├─► Map to sys_user_id
   │   │
   │   ├─► Insert into chat table
   │   │   ├── chat_body
   │   │   ├── sys_user_id
   │   │   └── chat_group_id
   │   │
   │   ├─► io.emit('updateChatGroups')  → All clients
   │   │
   │   └─► io.to(groupId).emit('receiveMessage', data)
   │       └─► Only clients in that chat group
```

---

## 🔧 Configuration Files

### **Environment Variables Required:**

```env
# Supabase
REACT_SUPABASE_URL=
REACT_SUPABASE_ANON_KEY=
REACT_SERVICE_ROLE_KEY=

# JWT (for mobile)
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

# Server
PORT=3000
NODE_ENV=development|production
```

### **Supabase Clients:**

1. **helpers/supabaseClient.js** (Anon Key)
   - Used for: Client-side operations, Auth
   - Access: Limited by RLS policies

2. **src/config/supabase.js** (Service Role Key)
   - Used for: Admin operations (if needed)
   - Access: Bypasses RLS policies

---

## 📁 File Organization

```
servana_backend/
├── index.js                    # Main server entry point
├── package.json               # Dependencies
│
├── helpers/
│   └── supabaseClient.js      # Supabase client (anon key)
│
├── middleware/
│   ├── authMiddleware.js      # (Unused - ES6 import)
│   ├── getCurrentUser.js      # Web auth (cookie-based)
│   └── getCurrentMobileUser.js # Mobile auth (JWT)
│
├── routes/
│   ├── auth.js                # Web authentication
│   ├── profile.js             # User profile management
│   ├── chat.js                # Chat routes + Socket handler
│   ├── department.js          # Department CRUD
│   ├── manageAgents.js        # Agent management
│   ├── queues.js              # Queue management
│   │
│   └── mobile/
│       ├── clientAccount.js   # Client registration/login
│       ├── departments.js     # Public departments
│       ├── messages.js        # Client messages
│       └── agent.js           # Agent info
│
└── src/                       # Alternative structure (partially used)
    ├── config/
    │   ├── index.js           # JWT config
    │   └── supabase.js        # Service role client
    ├── controllers/
    │   └── auth.controller.js # Alternative auth (unused)
    ├── middleware/
    │   ├── auth.middleware.js # Alternative middleware
    │   └── client.auth.middleware.js
    ├── routes/
    │   └── auth.routes.js     # Alternative routes (unused)
    └── utils/
        └── jwt.js             # JWT utilities
```

---

## 🔐 Security Features

1. **HTTP-only Cookies** (Web)
   - Prevents XSS attacks
   - Secure flag in production

2. **JWT Tokens** (Mobile)
   - Bearer token authentication
   - 7-day expiry

3. **Password Hashing**
   - bcrypt (10 rounds for clients)
   - Supabase handles agent passwords

4. **CORS Protection**
   - Whitelisted origin: http://localhost:5173

5. **Supabase RLS**
   - Row-level security policies
   - Service role key for admin operations

---

## 🚀 Key Features

1. **Dual Authentication Systems**
   - Web: Supabase Auth + Cookies
   - Mobile: JWT Bearer Tokens

2. **Real-Time Chat**
   - Socket.IO for instant messaging
   - Room-based broadcasting

3. **Role-Based Access**
   - system_user.role_id
   - Different permissions per role

4. **Department Management**
   - Agents assigned to departments
   - Chat groups linked to departments

5. **Profile Management**
   - User profiles with images
   - Supabase Storage for file uploads

6. **Queue System**
   - Unassigned chat groups
   - Agent assignment on first view

---

## 📝 Notes

- **Two Supabase Clients**: One with anon key (helpers/), one with service role (src/config/)
- **Mixed Auth Systems**: Web uses cookies, mobile uses JWT
- **Socket.IO**: Real-time chat requires cookie-based auth
- **Database**: All operations go through Supabase (PostgreSQL)
- **File Storage**: Profile images stored in Supabase Storage bucket "profile-images"

---

## 🔄 Data Flow Summary

```
Web Dashboard:
Request → Cookie Auth → getCurrentUser → Supabase Query → Response

Mobile App:
Request → JWT Auth → getCurrentMobileUser → Supabase Query → Response

Real-Time:
Socket Connection → Cookie Auth → handleSendMessage → Supabase Insert → Socket Broadcast
```

---

*Generated from codebase analysis*

