# CLAUDE.md

## Commands

```bash
npm run dev              # Start with nodemon, port 5000
npm test                 # Run all Jest tests
npm run test:coverage    # Jest with coverage report
npx jest testing/auth.test.js  # Single test file

node scripts/run-migration.js <migration-file>.sql

# Docker
docker build -f Dockerfile.dev -t servana-backend-dev .  # Dev
docker build -t servana-backend .                         # Prod
```

## Architecture

**Request flow:** HTTP → Express middleware → Route (`routes/index.js`) → Controller (orchestration only) → Service (business logic + DB/cache) → Supabase / Redis → `{ data }` or `{ error }`

**Auth (dual):**
- Web: cookie-based Supabase Auth (`middleware/getCurrentUser.js`)
- Mobile: Bearer JWT (`middleware/getCurrentMobileUser.js`, `utils/jwt.js`) — 15min access / 7d refresh
- RBAC: `middleware/checkPermission.js` + `constants/permissions.js` (`PERMISSIONS.X`)

**Socket.IO** (`socket-simple/`): Handles chat rooms, agent status/heartbeats, typing indicators. Instance shared via `app.set('io', io)`.

**Redis** (`helpers/redisClient.js`, `services/cache.service.js`): Optional. Three strategies — cache-aside (profiles, messages), write-through (departments, roles), set/hash ops (online users, sessions).

**Supabase** (`helpers/supabaseClient.js`): Service role key (bypasses RLS). Atomic operations via PostgreSQL RPCs.

## Conventions

- Soft deletes via `is_active` flags — no `DELETE`
- Status strings: use `constants/statuses.js` (`AGENT_STATUS`, `CHAT_STATUS`)
- Responses: `{ data }` success / `{ error }` failure
- CommonJS (`require`/`module.exports`) throughout
- Rate limiting: login (10/15min), socket heartbeats (5s/user)

## Key Tables

`sys_user`, `client`, `chat_group`, `chat`, `department`, `role`, `profile`, `chat_transfer_log`, `chat_feedback`

## Env Variables

Required: `REACT_SUPABASE_URL`, `REACT_SERVICE_ROLE_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
Optional: `PORT` (5000), `NODE_ENV`, `REDIS_HOST/PORT/PASSWORD`, `REACT_WEB_URL`, `REACT_WEB_PRODUCTION_URL`

## Route Map

| Prefix | Domain |
|--------|--------|
| `/auth` | Login, refresh, logout |
| `/profile` | User profiles |
| `/admins` | Admin CRUD |
| `/manage-agents` | Agent CRUD |
| `/departments` | Departments |
| `/queues` | Unassigned chats |
| `/chat` | Messages, chat groups |
| `/auto-replies` | Auto-reply config |
| `/analytics` | Metrics, dashboards |
| `/roles` | Role management |
| `/change-role` | Role assignments |
| `/macros` | Canned messages |
| `/otp`, `/clientAccount`, `/department`, `/messages` | Mobile |