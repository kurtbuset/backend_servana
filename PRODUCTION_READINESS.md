# Backend Production Readiness Assessment

**Overall Rating: 4/10 — Not production-ready in current state**

The core business logic, real-time infrastructure, Redis caching, and Docker setup are solid. Several critical gaps must be fixed before handling real traffic.

---

## What's Done Well

- Helmet security headers enabled
- Dual auth (Supabase cookies for web, custom JWT for mobile) works correctly
- Redis caching design (structured key prefixes, TTL policies, graceful fallback) is excellent
- Permission middleware with startup-time validation (fail-fast)
- Rate limiting on auth endpoints (10 attempts / 15 min)
- Graceful shutdown (SIGTERM/SIGINT), health check endpoint
- Supabase parameterized queries — no SQL injection risk
- Socket.IO per-message rate limiting
- Docker with non-root user and health checks

---

## Critical Issues — Do Not Deploy Until Fixed

### 1. OTP Logged in Plaintext
- **File:** `services/mobile/otp.service.js:197`
- `console.log('otp: ', otp)` exposes authentication secrets in any log aggregator
- **Fix:** Delete that line

### 2. OTP Returned in API Response
- **File:** `services/mobile/otp.service.js:211`
- Raw OTP returned in response body — should only go via SMS
- **Fix:** Remove OTP from response payload

### 3. No Structured Logging
- 728 `console.log/error/warn` calls across 57 files
- Emojis in logs (`🚀`, `❌`) won't parse in production log aggregators
- No request IDs, correlation tracking, or log levels
- **Fix:** Replace with [Pino](https://getpino.io/) or Winston (JSON output)

### 4. No Input Validation Library
- No joi, zod, or express-validator in dependencies
- `parseInt()` without `isNaN()` checks (`analytics.controller.js:149`, `:172`)
- No string length/character limits on user input
- **Fix:** Add zod (type-safe) or express-validator; validate at every controller entry point

### 5. Non-Atomic Multi-Step DB Operations
- **`services/chat.service.js:413–518`** — `transferChatGroup` does 3 sequential Supabase calls with no transaction. If step 3 fails, `chat_group` is orphaned.
- **`services/chat.service.js:524–589`** — `resolveChatGroup` updates feedback separately from resolution.
- **Fix:** Wrap in Postgres transactions via Supabase RPC functions

### 6. In-Memory Rate Limiting
- Socket message rate limits stored in a `Map` in process memory
- Won't survive restarts; breaks entirely in multi-instance deployments
- **Fix:** Redis-backed rate limiting (Redis is already available)

---

## High Priority — Before Any Production Traffic

### 7. Auth/Permissions Not Cached
- Every HTTP request calls `Supabase.auth.getUser()` + a DB permission query
- Every socket connection calls Supabase auth
- Will bottleneck under modest load
- **Fix:** Cache user/permission data in Redis with ~60s TTL

### 8. Missing Permission Check on Admin Endpoint
- **File:** `controllers/chat.controller.js:48`
- `GET /admin/room-stats` only has `getCurrentUser`, no permission check
- Any authenticated user can access admin stats
- **Fix:** Add the appropriate `checkPermission(PERMISSIONS.X)` middleware

### 9. Unhandled `Promise.all()` Rejections
- `chat.controller.js:102` and `:146` — no `.catch()` on `Promise.all`
- Fire-and-forget socket emissions in `mobile/message.controller.js:124–131` with no error handling
- **Fix:** Add `.catch()` or use `Promise.allSettled()` where partial failure is acceptable

### 10. No Error Monitoring
- No Sentry, Datadog, or equivalent error tracking
- Production errors will be invisible
- **Fix:** Integrate Sentry (5-minute setup)

---

## Medium Priority — Sprint 1

| Issue | File | Impact |
|-------|------|--------|
| Transfer log failure swallowed silently | `chat.service.js:446` | Silent data corruption possible |
| `incrementOtpAttempts` has no error handling | `otp.service.js:156` | OTP brute force partially untracked |
| No rate limiting on analytics endpoints | `analytics.controller.js` | Open to data scraping |
| CORS allows all RFC-1918 private IPs in dev | `cors.config.js:35` | Could accidentally ship to prod |
| No mobile JWT revocation mechanism | `utils/jwt.js` | Can't invalidate compromised token before 15m expiry |
| Redis cleanup uses `redis.keys()` O(N) | `redisClient.js` | Will lock Redis under load |
| `checkPermission` N+1 on `checkAnyPermission` | `checkPermission.js:74` | Performance regression at scale |

---

## Missing for Production

- [ ] Structured logging (Pino/Winston, JSON, log levels, request IDs)
- [ ] Input validation library (zod recommended)
- [ ] Redis-backed distributed rate limiting
- [ ] Postgres transaction wrappers for multi-step operations (Supabase RPCs)
- [ ] Permission/user result caching in Redis
- [ ] Error monitoring (Sentry)
- [ ] Comprehensive test suite (currently ~1 mock test)
- [ ] Load test results for concurrent socket connections
- [ ] Secrets management strategy (K8s Secrets / Vault / AWS SSM)
- [ ] API versioning (`/v1/...`)
- [ ] Deployment runbook and rollback procedure

---

## Quick Wins (Hours, Not Days)

1. Remove `console.log('otp: ', otp)` — `otp.service.js:197`
2. Remove raw OTP from API response — `otp.service.js:211`
3. Add `checkPermission` to `/admin/room-stats` — `chat.controller.js:48`
4. Add `isNaN()` guard after every `parseInt()` call
5. Add `.catch()` to all `Promise.all()` calls

---

## Scorecard

| Category | Score |
|---|---|
| Input Validation | 3/10 |
| Error Handling | 6/10 |
| Logging | 2/10 |
| Database Safety | 6/10 |
| Authentication | 7/10 |
| Authorization | 6/10 |
| Security | 4/10 |
| Scalability | 4/10 |
| Test Coverage | 1/10 |
| **Overall** | **4/10** |

---

*Generated 2026-03-30*
