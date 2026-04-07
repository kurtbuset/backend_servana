# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

```bash
npm run dev              # Start with nodemon (hot-reload), port 5000
npm start                # Production start
npm test                 # Run all Jest tests
npm run test:watch       # Jest in watch mode
npm run test:coverage    # Jest with coverage report

# Run a single test file
npx jest testing/auth.test.js

# Run migration against Supabase
node scripts/run-migration.js <migration-file>.sql
```

### Docker

```bash
# Development (includes devDependencies, uses nodemon)
docker build -f Dockerfile.dev -t servana-backend-dev .

# Production (npm ci --only=production, runs as non-root user)
docker build -t servana-backend .
```

## Architecture

### Request Flow

```
HTTP Request → Express middleware (helmet, CORS, JSON, cookies)
  → Route (routes/index.js maps paths to controllers)
    → Controller (orchestration only — no business logic)
      → Service (business logic, DB queries, cache operations)
        → Supabase (PostgreSQL) / Redis (cache)
  → Response { data: ... } or { error: "..." }
  → Global error handler (index.js) catches unhandled exceptions
```

Controllers expose a `getRouter()` method returning an Express Router. All 16 controllers are registered in `routes/index.js`.

### Dual Auth System

**Web clients** use cookie-based Supabase Auth:
- `middleware/getCurrentUser.js` extracts token from HTTP-only cookies, validates with Supabase
- Login sets `access_token`, `refresh_token`, `session_id` cookies

**Mobile clients** use custom JWT:
- `middleware/getCurrentMobileUser.js` extracts Bearer token from Authorization header
- `utils/jwt.js` signs/verifies with `JWT_ACCESS_SECRET` (15min) and `JWT_REFRESH_SECRET` (7d)

**Permission checks**: `middleware/checkPermission.js` enforces RBAC using constants from `constants/permissions.js` (use `PERMISSIONS.X` constants, not raw strings).

### Socket.IO (Real-time)

All socket logic lives in `socket-simple/`. Entry point: `socket-simple/index.js` via `initializeSocket()`.

Key modules:
- `auth.js` — Socket auth middleware (supports both web cookies and mobile JWT)
- `connection.js` — Connect/disconnect lifecycle, room joins
- `agent-status.js` — Agent online/offline tracking with heartbeats
- `room-management.js` — Chat room access control (`chat_${chatGroupId}`, `department_${deptId}`)

Main events: `chat:join`, `sendMessage`/`receiveMessage`, `resolveChat`/`chatResolved`, `typing`/`stopTyping`, `agentOnline`/`agentOffline`/`agentHeartbeat`, `updateAgentStatus`, `messageStatusUpdate`.

The Socket.IO instance is attached to Express via `app.set('io', io)` for use in REST controllers.

### Redis Caching

`helpers/redisClient.js` exports a `cacheManager` singleton with structured key prefixes and per-type TTLs.

Three strategies:
- **Cache-aside** (profiles, messages): check cache → miss → fetch DB → populate cache
- **Write-through** (departments, roles): update DB and cache atomically via `setWriteThrough()`
- **Set/Hash ops** (online users, sessions): `addToSet()`, `setHashField()`, etc.

Redis is optional — the app starts without it if unavailable. Business-level cache wrappers are in `services/cache.service.js`.

### Supabase

Client configured in `helpers/supabaseClient.js` using service role key (bypasses RLS). Key tables: `sys_user`, `client`, `chat_group`, `chat`, `department`, `role`, `profile`, `chat_transfer_log`, `chat_feedback`.

Atomic multi-table operations use PostgreSQL RPC functions (see `migrations/011_atomic_user_creation.sql`).

### Database Migrations

SQL files in `migrations/` (numbered 001–013). Run via `node scripts/run-migration.js <filename>`. Other one-off scripts in `scripts/` handle permission fixes, cache migrations, and data cleanup.

## Key Conventions

- **Soft deletes**: tables use `is_active` flags (`sys_user_is_active`, `client_is_active`, `dept_is_active`) instead of DELETE
- **Status enums**: use `constants/statuses.js` (`AGENT_STATUS`, `CHAT_STATUS`) — not hardcoded strings
- **Response format**: `{ data: ... }` for success, `{ error: "..." }` for errors
- **CommonJS**: all modules use `require`/`module.exports` (package.json `"type": "commonjs"`)
- **Rate limiting**: auth login is rate-limited (10 attempts/15 min); socket heartbeats are rate-limited (5s per user)

## Testing

Tests live in `testing/`. Jest setup (`testing/setup.js`) sets `NODE_ENV=test` and 30s timeout. Tests mock service layers with Jest — they don't hit real databases. Coverage collects from `controllers/`, `services/`, `middleware/`.

## Environment Variables

Required (validated at startup by `config/env.validation.js`):
- `REACT_SUPABASE_URL`, `REACT_SERVICE_ROLE_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`

Optional:
- `PORT` (default 5000), `NODE_ENV`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `REACT_WEB_URL`, `REACT_WEB_PRODUCTION_URL` (CORS whitelist)

## Route Map

| Prefix | Controller | Domain |
|--------|-----------|--------|
| `/auth` | auth | Login, refresh, logout |
| `/profile` | profile | User profiles |
| `/admins` | admin | Admin CRUD |
| `/manage-agents` | agent | Agent CRUD |
| `/departments` | department | Department management |
| `/queues` | queue | Unassigned chats |
| `/chat` | chat | Messages, chat groups |
| `/auto-replies` | autoReply | Auto-reply config |
| `/analytics` | analytics | Metrics, dashboards |
| `/roles` | role | Role management |
| `/change-role` | changeRole | Role assignments |
| `/macros` | macro | Canned messages |
| `/otp` | mobile/otp | Mobile OTP |
| `/clientAccount` | mobile/clientAccount | Mobile accounts |
| `/department` | mobile/department | Mobile departments |
| `/messages` | mobile/message | Mobile messages |
