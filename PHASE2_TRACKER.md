# Backend Optimization Tracker — Phase 2

Requires frontend coordination for items 1-3. Items 4-7 are backend-only.

---

## Status

| # | Item | Severity | Status | Frontend Change |
|---|------|----------|--------|-----------------|
| 1 | Standardize response formats | MEDIUM | DONE | Yes |
| 2 | Standardize error response keys | MEDIUM | STANDBY | Yes |
| 3 | Normalize socket event names | MEDIUM | STANDBY | Yes |
| 4 | Add transaction boundaries | HIGH | DONE | No |
| 5 | Move business logic to services | MEDIUM | DONE | No |
| 6 | Standardize service error propagation | MEDIUM | DONE | No |
| 7 | Unify auth token verification | MEDIUM | STANDBY | No |

---

## Completed Items

### 1. Standardize Response Formats — DONE
All 16 controllers now return `{ data: ... }` wrapper for success responses.

**Changes applied to:**
- `admin.controller.js` — 4 responses wrapped
- `department.controller.js` — 6 responses wrapped
- `chat.controller.js` — 8 responses wrapped
- `agent.controller.js` — 4 responses wrapped
- `role.controller.js` — 5 responses wrapped
- `autoReply.controller.js` — 7 responses wrapped
- `macro.controller.js` — 4 responses wrapped
- `profile.controller.js` — 5 responses wrapped
- `analytics.controller.js` — 3 responses wrapped, error format also standardized from `{ success, message }` to `{ error }`
- `queue.controller.js` — 4 responses wrapped
- `changeRole.controller.js` — 3 responses wrapped
- `auth.controller.js` — 5 responses wrapped
- `mobile/department.controller.js` — 1 response wrapped
- `mobile/clientAccount.controller.js` — 5 responses wrapped, 1 error key fixed (`message` → `error`)
- `mobile/message.controller.js` — 6 responses wrapped
- `mobile/otp.controller.js` — 2 responses wrapped

**Frontend impact:** All `response.data` accesses need to become `response.data.data`. Can be handled with a shared axios response interceptor.

### 4. Add Transaction Boundaries — DONE
Admin and agent creation now use atomic PostgreSQL RPC functions.

**Changes:**
| Operation | Before | After |
|---|---|---|
| Create admin | 3 sequential inserts + manual rollback | Auth API + single `create_admin_atomic` RPC |
| Create agent | 4 sequential inserts + manual rollback | Auth API + single `create_agent_atomic` RPC |

**Files changed:** `services/admin.service.js`, `services/agent.service.js`
**New file:** `migrations/011_atomic_user_creation.sql` — **must be deployed to database**
**Performance:** Profile + sys_user + departments created in one DB round trip. No orphaned records on failure. Rollback only needed for Supabase Auth user (which is external).

> **NOTE:** The migration `011_atomic_user_creation.sql` must be run against the database before these changes take effect. Without the RPC functions, admin/agent creation will fail.

### 5. Move Business Logic to Services — DONE
Transfer orchestration DB lookups and duration parsing moved out of controllers.

**Changes:**
- Transfer detail lookups (dept names, agent name) → `chatService.getTransferDetails()`
- `parseDurationToSeconds()` → `utils/parseDuration.js` (used by both `chat.controller.js` and `mobile/message.controller.js`)
- Removed duplicate `parseDurationToSeconds` method from both controllers

**Files changed:** `controllers/chat.controller.js`, `controllers/mobile/message.controller.js`, `services/chat.service.js`
**New file:** `utils/parseDuration.js`

### 6. Standardize Service Error Propagation — DONE
Services now throw on error instead of silently returning empty arrays.

**Changes:**
| Service Method | Before | After |
|---|---|---|
| `chatService.getCannedMessagesByRole` | Returns `[]` silently | Throws, controller catches |
| `chatService.getChatGroupsByUser` | Returns `[]` silently | Throws, controller catches |
| `chatService.getResolvedChatGroupsByUser` | Returns `[]` silently | Throws, controller catches |
| `queueService.getUnassignedChatGroups` | Returns `[]` silently | Throws, controller catches |

**Kept as-is:** `agentAssignmentService.getAvailableAgents()` and `assignQueuedChatsToAgent()` still return `[]` on error — these are internal methods where "no agents available" is a valid fallback, not a silent failure.

**Files changed:** `services/chat.service.js`, `services/queue.service.js`

---

## Standby Items

### 2. Standardize Error Response Keys
Change all `{ message: "..." }` error responses to `{ error: "..." }`.

**Affected files:** `middleware/authMiddleware.js` (2 lines), `agent.controller.js` (1 line)
**Frontend impact:** Error handlers checking `response.data.message` must switch to `response.data.error`.
**Status:** Waiting for frontend coordination.

### 3. Normalize Socket Event Names
Switch all 34 emitted events and 12 listeners from mixed camelCase to `domain:action` format.

**Key renames:**
- `agentStatusChanged` → `agent:status-changed`
- `customerListUpdate` → `customer:list-updated`
- `receiveMessage` → `message:received`
- `messageDelivered` → `message:delivered`
- `chatResolved` → `chat:resolved`
- `joinChatGroup` → `chat:join`
- `sendMessage` → `message:send`
- `typing` / `stopTyping` → `typing:start` / `typing:stop`

**Affected files:** 6 socket files (server), all frontend socket listeners (web + mobile)
**Frontend impact:** Largest change — every `socket.on()` and `socket.emit()` in both `web_servana` and `mobile_servana`.
**Status:** Waiting for frontend coordination.

### 7. Unify Auth Token Verification
Extract shared `verifyWebToken(token)` used by both REST middleware and Socket.IO auth.

**Affected files:** `middleware/getCurrentUser.js`, `socket-simple/auth.js`, `utils/verifyToken.js` (new)
**Frontend impact:** None.
**Status:** Waiting — low priority, depends on items 1-6 completing first.
