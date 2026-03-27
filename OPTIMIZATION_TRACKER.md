# Backend Optimization Tracker — Phase 1

Safe, backend-only changes. No frontend coordination required.

---

## Status

| # | Item | Severity | Status | Files Affected |
|---|------|----------|--------|----------------|
| 1 | Env var validation at startup | CRITICAL | [x] Done | `config/env.validation.js` (new), `index.js`, `middleware/authMiddleware.js` |
| 2 | Global Express error handler | CRITICAL | [x] Done | `index.js` |
| 3 | Cache invalidation gaps | CRITICAL | [x] Done | `services/autoReply.service.js`, `services/macro.service.js`, `services/profile.service.js`, `services/role.service.js`, `services/cache.service.js`, `helpers/redisClient.js` |
| 4 | Extract shared chat group formatting | HIGH | [x] Done | `utils/formatChatGroups.js` (new), `controllers/chat.controller.js`, `controllers/queue.controller.js` |
| 5 | Extract shared service methods | HIGH | [x] Done | `utils/messageHelpers.js` (new), `services/chat.service.js`, `services/queue.service.js` |
| 6 | Create status constants | MEDIUM | [x] Done | `constants/statuses.js` (new), `services/profile.service.js`, `services/auth.service.js`, `controllers/chat.controller.js` |
| 7 | Fix N+1 query in getDepartmentMembers | CRITICAL | [x] Done | `services/department.service.js` |
| 8 | Remove duplicate health check | HIGH | [x] Done | `routes/index.js` |
| 9 | Remove unused deps & imports | LOW | [x] Done | `package.json`, `routes/index.js` |
| 10 | Apply rate limiting to auth endpoints | HIGH | [x] Done | `controllers/auth.controller.js`, `controllers/mobile/otp.controller.js` |

---

## Details

### 1. Env Var Validation at Startup
- Create `config/env.validation.js` to validate required env vars on boot
- Remove hardcoded `'your_jwt_secret'` fallback from `middleware/authMiddleware.js`
- Required vars: `REACT_SUPABASE_URL`, `REACT_SERVICE_ROLE_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`

### 2. Global Express Error Handler
- Add centralized `app.use((err, req, res, next) => {...})` after route setup in `index.js`
- Consistent error shape: `{ error: message }`

### 3. Cache Invalidation Gaps
- `autoReply.service.js`: Add invalidation after `updateAutoReply()`, `toggleAutoReplyStatus()`
- `macro.service.js`: Add invalidation after `createMacro()`, `updateMacro()`, `deleteMacro()`
- `profile.service.js`: Add invalidation after `updateUserEmail()`, `updateProfile()`, `updateAgentStatus()`
- `role.service.js`: Add invalidation after `updatePrivileges()`, `updateRole()`

### 4. Extract Shared Chat Group Formatting
- Create `utils/formatChatGroups.js` — shared by `chat.controller.js` and `queue.controller.js`
- Eliminates ~150 lines of duplicated code across 3 methods

### 5. Extract Shared Service Methods
- Create `utils/messageHelpers.js` with 5 methods duplicated between `chatService` and `queueService`:
  - `getProfileImages`, `getLatestMessageTimes`, `determineSenderType`, `getSenderName`, `getSenderImageOptimized`
- Route all department fetching through `departmentService` (already has caching)

### 6. Create Status Constants
- Create `constants/statuses.js` with `AGENT_STATUS` and `CHAT_STATUS`
- Replace hardcoded strings: `'accepting_chats'`, `'not_accepting_chats'`, `'offline'`, `'active'`, `'queued'`, `'resolved'`, `'pending'`

### 7. Fix N+1 Query in getDepartmentMembers
- `services/department.service.js` lines 191-253: 4 queries per user in loop
- Replace with batch `.in()` queries + in-memory join

### 8. Remove Duplicate Health Check
- Health check defined in both `index.js` and `routes/index.js` — keep `index.js` version

### 9. Remove Unused Dependencies & Imports
- Remove from `package.json`: `react-dom`, `lint`, `dompurify`, `jsdom`, `validator`
- Remove unused `roleService` import from `routes/index.js`

### 10. Apply Rate Limiting
- `express-rate-limit` is installed but never used
- Apply to `/auth/login` and `/otp/request-otp`

---

## Phase 2 (Future — Requires Frontend Coordination)
- Standardize response formats (`{ data: ... }` wrapper)
- Standardize error keys (`{ error }` everywhere)
- Normalize socket event names (`domain:action` format)
- Add transaction boundaries for multi-step creation
- Move business logic from controllers to services
- Standardize service error propagation
- Unify socket/REST auth token verification
