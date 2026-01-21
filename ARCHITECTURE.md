# Backend Architecture

## MVC Pattern Implementation

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT                               │
│                    (Web/Mobile App)                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTP Request
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      EXPRESS SERVER                          │
│                       (index.js)                             │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │              MIDDLEWARE LAYER                       │    │
│  │  • CORS                                             │    │
│  │  • Cookie Parser                                    │    │
│  │  • getCurrentUser (Authentication)                  │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      ROUTES LAYER                            │
│                   (routes/*.js)                              │
│                                                              │
│  • Define endpoints                                          │
│  • Apply middleware                                          │
│  • Route to controllers                                      │
│                                                              │
│  Examples:                                                   │
│  GET  /chat/chatgroups    → chatController.getChatGroups    │
│  POST /departments        → deptController.createDepartment  │
│  PUT  /profile            → profileController.updateProfile  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   CONTROLLERS LAYER                          │
│                 (controllers/*.js)                           │
│                                                              │
│  • Receive requests                                          │
│  • Validate input                                            │
│  • Call service methods                                      │
│  • Format responses                                          │
│  • Handle errors                                             │
│                                                              │
│  Responsibilities:                                           │
│  ✓ Request/Response handling                                │
│  ✓ Input validation                                          │
│  ✓ Error handling                                            │
│  ✓ HTTP status codes                                         │
│  ✗ Business logic (delegated to services)                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    SERVICES LAYER                            │
│                  (services/*.js)                             │
│                                                              │
│  • Business logic                                            │
│  • Data processing                                           │
│  • Database operations                                       │
│  • External API calls                                        │
│  • Data transformation                                       │
│                                                              │
│  Responsibilities:                                           │
│  ✓ Business rules                                            │
│  ✓ Data validation                                           │
│  ✓ Database queries                                          │
│  ✓ Data transformation                                       │
│  ✗ HTTP concerns (no req/res)                               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   DATABASE LAYER                             │
│                  (Supabase Client)                           │
│                                                              │
│  • PostgreSQL Database                                       │
│  • Supabase Auth                                             │
│  • Storage Buckets                                           │
└─────────────────────────────────────────────────────────────┘
```

## Request Flow Example

### Example: Get Chat Groups

```
1. CLIENT
   └─> GET /chat/chatgroups

2. EXPRESS SERVER
   └─> Apply middleware (getCurrentUser)
       └─> Extract userId from JWT token

3. ROUTES (routes/chat.js)
   └─> router.get("/chatgroups", chatController.getChatGroups)

4. CONTROLLER (controllers/chat.controller.js)
   └─> getChatGroups(req, res)
       ├─> Extract userId from req
       ├─> Call chatService.getChatGroupsByUser(userId)
       ├─> Call chatService.getProfileImages(profIds)
       ├─> Format response data
       └─> Send JSON response

5. SERVICE (services/chat.service.js)
   └─> getChatGroupsByUser(userId)
       ├─> Query chat_group table
       ├─> Join with department and client tables
       ├─> Filter by userId
       └─> Return raw data

6. DATABASE (Supabase)
   └─> Execute SQL query
       └─> Return results

7. RESPONSE FLOW (back up the chain)
   Service → Controller → Route → Express → Client
```

## Module Structure

### Chat Module
```
chat/
├── routes/chat.js
│   └─> Defines: GET /canned-messages, /chatgroups, /:clientId
│
├── controllers/chat.controller.js
│   ├─> getCannedMessages()
│   ├─> getChatGroups()
│   ├─> getChatMessages()
│   └─> handleSendMessage() [WebSocket]
│
└── services/chat.service.js
    ├─> getCannedMessagesByRole()
    ├─> getUserRole()
    ├─> getChatGroupsByUser()
    ├─> getProfileImages()
    ├─> getChatMessages()
    ├─> authenticateSocketUser()
    └─> insertMessage()
```

### Department Module
```
department/
├── routes/department.js
│   └─> Defines: GET /, POST /, PUT /:id, PUT /:id/toggle
│
├── controllers/department.controller.js
│   ├─> getAllDepartments()
│   ├─> createDepartment()
│   ├─> updateDepartment()
│   └─> toggleDepartmentStatus()
│
└── services/department.service.js
    ├─> getAllDepartments()
    ├─> createDepartment()
    ├─> updateDepartment()
    └─> toggleDepartmentStatus()
```

### Profile Module
```
profile/
├── routes/profile.js
│   └─> Defines: GET /, PUT /, POST /image
│
├── controllers/profile.controller.js
│   ├─> getCurrentUserProfile()
│   ├─> updateCurrentUserProfile()
│   └─> uploadProfileImage()
│
└── services/profile.service.js
    ├─> fetchUserAndProfile()
    ├─> fetchCurrentImage()
    ├─> updateUserEmail()
    ├─> updateProfile()
    ├─> uploadImageToStorage()
    ├─> unsetPreviousCurrentImages()
    └─> insertProfileImage()
```

## WebSocket Integration

```
┌─────────────────────────────────────────────────────────────┐
│                    SOCKET.IO SERVER                          │
│                      (index.js)                              │
│                                                              │
│  io.on('connection', (socket) => {                          │
│    socket.on('joinChatGroup', ...)                          │
│    socket.on('sendMessage', handleSendMessage)              │
│  })                                                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              CHAT CONTROLLER (WebSocket)                     │
│          controllers/chat.controller.js                      │
│                                                              │
│  handleSendMessage(message, io, socket)                     │
│    ├─> Authenticate user from socket                        │
│    ├─> Call chatService.insertMessage()                     │
│    ├─> Emit 'updateChatGroups' to all clients              │
│    └─> Emit 'receiveMessage' to chat group                 │
└─────────────────────────────────────────────────────────────┘
```

## Error Handling Flow

```
SERVICE throws error
    ↓
CONTROLLER catches error
    ↓
CONTROLLER logs error
    ↓
CONTROLLER sends appropriate HTTP status
    ↓
CLIENT receives error response
```

## Benefits of This Architecture

### 1. Separation of Concerns
- Routes: Routing only
- Controllers: Request handling
- Services: Business logic

### 2. Testability
```javascript
// Test service independently
const result = await chatService.getChatGroups(userId);
expect(result).toHaveLength(5);

// Test controller with mocked service
jest.mock('../services/chat.service');
chatService.getChatGroups.mockResolvedValue(mockData);
```

### 3. Reusability
```javascript
// Service can be used by multiple controllers
class ChatController {
  async getChatGroups() {
    return await chatService.getChatGroupsByUser(userId);
  }
}

class AdminController {
  async getAllChats() {
    return await chatService.getChatGroupsByUser(adminId);
  }
}
```

### 4. Maintainability
- Easy to locate bugs
- Clear responsibility boundaries
- Simple to add features
- Consistent patterns

## Code Standards

### Controllers
```javascript
class ExampleController {
  async methodName(req, res) {
    try {
      // 1. Extract data from request
      const { param } = req.body;
      
      // 2. Validate input
      if (!param) {
        return res.status(400).json({ error: "param required" });
      }
      
      // 3. Call service
      const result = await exampleService.doSomething(param);
      
      // 4. Send response
      res.json(result);
    } catch (err) {
      // 5. Handle errors
      console.error("Error:", err.message);
      res.status(500).json({ error: "Server error" });
    }
  }
}
```

### Services
```javascript
class ExampleService {
  async doSomething(param) {
    // 1. Business logic
    const processed = this.processData(param);
    
    // 2. Database operation
    const { data, error } = await supabase
      .from("table")
      .select("*")
      .eq("field", processed);
    
    // 3. Throw errors (don't handle)
    if (error) throw error;
    
    // 4. Return data
    return data;
  }
}
```

### Routes
```javascript
const router = express.Router();
const controller = require("../controllers/example.controller");

// Apply middleware
router.use(getCurrentUser);

// Define routes
router.get("/", (req, res) => controller.getAll(req, res));
router.post("/", (req, res) => controller.create(req, res));

module.exports = router;
```

## Next Steps

1. ✅ Refactor remaining routes
2. ⬜ Add unit tests
3. ⬜ Add integration tests
4. ⬜ Add API documentation
5. ⬜ Implement logging service
6. ⬜ Add request validation middleware
7. ⬜ Implement rate limiting
8. ⬜ Add monitoring and alerts
