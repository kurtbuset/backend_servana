# Servana Backend API Documentation

## Overview

The Servana Backend API is a Node.js/Express application that provides RESTful endpoints for a customer service chat platform. It supports both web and mobile clients with role-based access control, real-time messaging, and comprehensive user management.

## Base URL
- **Development:** `http://localhost:3000`
- **Production:** `[Your production URL]`

## Authentication

The API uses two authentication methods:

### Web Clients (Cookie-based)
- HTTP-only cookies containing Supabase access tokens
- Automatically handled by browser
- Secure and SameSite attributes in production

### Mobile Clients (JWT-based)
- Bearer token in Authorization header
- Custom JWT with client information
- Format: `Authorization: Bearer <jwt_token>`

## Common Response Format

```json
{
  "data": {},
  "error": "Error message if applicable"
}
```

## HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

---

## Authentication Endpoints

### POST /auth/login
Login user with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "user": {
    "sys_user_id": 1,
    "role_id": 2,
    "prof_id": 1,
    "sys_user_email": "user@example.com"
  }
}
```

**Cookies Set:**
- `access_token` - Supabase access token (HTTP-only)
- `refresh_token` - Supabase refresh token (HTTP-only)

### GET /auth/me
Check current authentication status.

**Headers Required:**
- Cookie with access_token (web) OR Authorization Bearer token (mobile)

**Response:**
```json
{
  "authenticated": true,
  "user": {
    "sys_user_id": 1,
    "role_id": 2,
    "prof_id": 1,
    "sys_user_email": "user@example.com"
  }
}
```

### GET /auth/user-id
Get current user's system ID.

**Response:**
```json
{
  "userId": 1
}
```

### POST /auth/logout
Logout current user.

**Response:**
```json
{
  "message": "Logged out successfully"
}
```

---

## Chat Endpoints

### GET /chat/canned-messages
Get pre-written messages for current user's role.

**Authentication:** Required

**Response:**
```json
[
  {
    "canned_id": 1,
    "canned_message": "Hello! How can I help you today?"
  },
  {
    "canned_id": 2,
    "canned_message": "Thank you for contacting us."
  }
]
```

### GET /chat/chatgroups
Get all active chat groups assigned to current user.

**Authentication:** Required

**Response:**
```json
[
  {
    "chat_group_id": 1,
    "dept_id": 1,
    "sys_user_id": 1,
    "status": "active",
    "department": {
      "dept_name": "Technical Support"
    },
    "client": {
      "client_id": 1,
      "client_number": "C001",
      "prof_id": 2,
      "profile": {
        "prof_firstname": "John",
        "prof_lastname": "Doe"
      }
    },
    "profileImage": "https://example.com/profile.jpg",
    "lastMessageTime": "2024-01-15T10:30:00Z"
  }
]
```

### GET /chat/:clientId
Get chat messages for a specific client.

**Authentication:** Required

**Parameters:**
- `clientId` (number) - Client ID

**Response:**
```json
{
  "messages": [
    {
      "chat_id": 1,
      "chat_message": "Hello, I need help",
      "chat_created_at": "2024-01-15T10:30:00Z",
      "sender_type": "client",
      "client": {
        "profile": {
          "prof_firstname": "John",
          "prof_lastname": "Doe"
        }
      }
    }
  ],
  "profileImages": {
    "2": "https://example.com/profile.jpg"
  }
}
```

### POST /chat/:chatGroupId/transfer
Transfer chat group to another department.

**Authentication:** Required

**Parameters:**
- `chatGroupId` (number) - Chat group ID

**Request Body:**
```json
{
  "targetDepartmentId": 2,
  "targetAgentId": 3
}
```

**Response:**
```json
{
  "message": "Chat transferred successfully",
  "chatGroupId": 1,
  "newDepartment": "Sales",
  "newAgent": "Jane Smith"
}
```

### GET /chat/admin/room-stats
Get real-time room statistics (admin only).

**Authentication:** Required (Admin role)

**Response:**
```json
{
  "totalRooms": 15,
  "activeRooms": 8,
  "totalUsers": 25,
  "roomDetails": [
    {
      "roomId": "1",
      "userCount": 2,
      "lastActivity": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

## Department Endpoints

### GET /departments
Get all departments.

**Authentication:** Required

**Response:**
```json
[
  {
    "dept_id": 1,
    "dept_name": "Technical Support",
    "dept_is_active": true,
    "dept_created_at": "2024-01-01T00:00:00Z"
  }
]
```

### POST /departments
Create new department.

**Authentication:** Required (Admin role)

**Request Body:**
```json
{
  "dept_name": "New Department"
}
```

**Response:**
```json
{
  "message": "Department created successfully",
  "department": {
    "dept_id": 2,
    "dept_name": "New Department",
    "dept_is_active": true
  }
}
```

### PUT /departments/:id
Update department.

**Authentication:** Required (Admin role)

**Parameters:**
- `id` (number) - Department ID

**Request Body:**
```json
{
  "dept_name": "Updated Department Name"
}
```

### PUT /departments/:id/toggle
Toggle department active status.

**Authentication:** Required (Admin role)

**Parameters:**
- `id` (number) - Department ID

---

## Profile Endpoints

### GET /profile
Get current user's profile with privileges.

**Authentication:** Required

**Response:**
```json
{
  "user": {
    "sys_user_id": 1,
    "sys_user_email": "user@example.com",
    "role_id": 2
  },
  "profile": {
    "prof_id": 1,
    "prof_firstname": "John",
    "prof_lastname": "Doe",
    "prof_phone": "+1234567890"
  },
  "privileges": {
    "priv_can_create_admin": false,
    "priv_can_manage_agents": true
  },
  "department": {
    "dept_name": "Technical Support"
  },
  "profileImage": "https://example.com/profile.jpg"
}
```

### PUT /profile
Update current user's profile.

**Authentication:** Required

**Request Body:**
```json
{
  "email": "newemail@example.com",
  "firstname": "John",
  "lastname": "Doe",
  "phone": "+1234567890"
}
```

### POST /profile/image
Upload profile image.

**Authentication:** Required

**Request:** Multipart form data with image file

**Response:**
```json
{
  "message": "Profile image uploaded successfully",
  "imageUrl": "https://example.com/new-profile.jpg"
}
```

---

## Queue Endpoints

### GET /queues/chatgroups
Get unassigned chat groups (queue).

**Authentication:** Required (Agent role)

**Response:**
```json
[
  {
    "chat_group_id": 1,
    "dept_id": 1,
    "status": "unassigned",
    "client": {
      "client_number": "C001",
      "profile": {
        "prof_firstname": "John",
        "prof_lastname": "Doe"
      }
    },
    "department": {
      "dept_name": "Technical Support"
    },
    "profileImage": "https://example.com/profile.jpg",
    "lastMessageTime": "2024-01-15T10:30:00Z"
  }
]
```

### POST /queues/:chatGroupId/accept
Accept chat from queue.

**Authentication:** Required (Agent role)

**Parameters:**
- `chatGroupId` (number) - Chat group ID

**Response:**
```json
{
  "message": "Chat accepted successfully",
  "chatGroupId": 1
}
```

### GET /queues/:clientId
Get chat messages and assign to current user.

**Authentication:** Required (Agent role)

**Parameters:**
- `clientId` (number) - Client ID

---

## Agent Management Endpoints

### GET /manage-agents/agents
Get all agents with departments.

**Authentication:** Required (Admin role)

**Response:**
```json
[
  {
    "sys_user_id": 1,
    "sys_user_email": "agent@example.com",
    "sys_user_is_active": true,
    "profile": {
      "prof_firstname": "Jane",
      "prof_lastname": "Smith"
    },
    "departments": [
      {
        "dept_name": "Technical Support"
      }
    ],
    "profileImage": "https://example.com/agent-profile.jpg"
  }
]
```

### POST /manage-agents/agents
Create new agent.

**Authentication:** Required (Admin role)

**Request Body:**
```json
{
  "email": "newagent@example.com",
  "password": "password123",
  "firstname": "New",
  "lastname": "Agent",
  "phone": "+1234567890",
  "departmentId": 1
}
```

### PUT /manage-agents/agents/:id
Update agent.

**Authentication:** Required (Admin role)

**Parameters:**
- `id` (number) - Agent ID

**Request Body:**
```json
{
  "email": "updated@example.com",
  "firstname": "Updated",
  "lastname": "Agent",
  "phone": "+1234567890",
  "departmentId": 2
}
```

---

## Role Management Endpoints

### GET /roles
Get all roles with privileges.

**Authentication:** Required (Admin role)

**Response:**
```json
[
  {
    "role_id": 1,
    "role_name": "Admin",
    "role_is_active": true,
    "privilege": {
      "priv_can_create_admin": true,
      "priv_can_manage_agents": true,
      "priv_can_manage_departments": true
    }
  }
]
```

### POST /roles
Create new role.

**Authentication:** Required (Admin role)

**Request Body:**
```json
{
  "role_name": "New Role",
  "privileges": {
    "priv_can_create_admin": false,
    "priv_can_manage_agents": true
  }
}
```

---

## Macro Endpoints

### GET /agents (Macros for Agents)
Get macros for agent role.

**Authentication:** Required (Agent role)

**Response:**
```json
[
  {
    "macro_id": 1,
    "macro_name": "Welcome Message",
    "macro_content": "Welcome to our support chat!",
    "macro_is_active": true
  }
]
```

### POST /agents (Create Agent Macro)
Create macro for agent role.

**Authentication:** Required (Agent role)

**Request Body:**
```json
{
  "macro_name": "New Macro",
  "macro_content": "Macro content here"
}
```

---

## Mobile-Specific Endpoints

### Client Account (/clientAccount)
- `POST /clientAccount/register` - Register new client
- `POST /clientAccount/login` - Client login
- `GET /clientAccount/profile` - Get client profile
- `PUT /clientAccount/profile` - Update client profile

### Mobile Departments (/department)
- `GET /department` - Get departments for mobile
- `GET /department/:id/agents` - Get department agents

### Mobile Messages (/messages)
- `GET /messages/:clientId` - Get client messages
- `POST /messages` - Send message from mobile
- `GET /messages/history/:clientId` - Get message history

---

## Error Handling

### Common Error Responses

**401 Unauthorized:**
```json
{
  "error": "Not authenticated"
}
```

**403 Forbidden:**
```json
{
  "error": "Account not linked or inactive"
}
```

**404 Not Found:**
```json
{
  "error": "Resource not found"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal server error"
}
```

---

## Rate Limiting

- Socket events: 30 messages per minute per user
- User status updates: 10 updates per minute per user
- API endpoints: No explicit rate limiting (consider implementing)

---

## Security Features

- HTTP-only cookies for web authentication
- JWT tokens for mobile authentication
- CORS protection with allowed origins
- Helmet.js security headers
- Input validation and sanitization
- Role-based access control
- Secure file upload handling

---

## Development Notes

### Environment Variables Required
```env
REACT_SUPABASE_URL=your_supabase_url
REACT_SERVICE_ROLE_KEY=your_service_role_key
JWT_ACCESS_SECRET=your_jwt_secret
REACT_WEB_URL=http://localhost:5173
NODE_ENV=development
PORT=3000
```

### Testing
- Jest configuration included
- Test files in `/testing` directory
- Run tests: `npm test`

### Database
- PostgreSQL via Supabase
- Automatic migrations handled by Supabase
- Service role key required for admin operations

---

## Support

For API support or questions, please refer to the backend architecture documentation or contact the development team.