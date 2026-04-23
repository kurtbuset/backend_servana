# Servana Backend

A Node.js/Express backend for a customer service chat platform with real-time messaging, agent management, and role-based access control.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Start development server
npm run dev

# Run tests
npm test
```

## Tech Stack

- **Framework:** Express.js
- **Database:** Supabase (PostgreSQL)
- **Cache:** Redis
- **Real-time:** Socket.IO
- **Auth:** JWT + Supabase Auth

## Key Features

- Real-time chat messaging
- Agent assignment and queue management
- Role-based permissions (RBAC)
- Department organization
- Auto-replies and macros
- Mobile and web client support
- Push notifications

## Project Structure

```
backend_servana/
├── config/          # App configuration
├── controllers/     # Request handlers
├── services/        # Business logic
├── routes/          # API endpoints
├── socket/          # Socket.IO handlers
├── middleware/      # Auth & permissions
├── migrations/      # Database migrations
└── utils/           # Helper functions
```

## API Endpoints

| Route            | Purpose                        |
| ---------------- | ------------------------------ |
| `/auth`          | Login, logout, token refresh   |
| `/chat`          | Messages and chat groups       |
| `/queues`        | Unassigned chat management     |
| `/departments`   | Department CRUD                |
| `/manage-agents` | Agent management               |
| `/roles`         | Role and permission management |
| `/macros`        | Canned message templates       |
| `/auto-replies`  | Automated responses            |

## Authentication

- **Web:** Cookie-based Supabase Auth
- **Mobile:** JWT Bearer tokens (15min access, 7d refresh)

## Environment Variables

Required:

- `REACT_SUPABASE_URL` - Supabase project URL
- `REACT_SERVICE_ROLE_KEY` - Supabase service key
- `JWT_ACCESS_SECRET` - JWT signing secret
- `JWT_REFRESH_SECRET` - Refresh token secret
- `REDIS_URL` - Redis connection URL (cloud) OR
- `REDIS_HOST`, `REDIS_PORT` - Redis config (local)

Optional:

- `PORT` - Server port (default: 5000)
- `NODE_ENV` - Environment mode

## Docker

```bash
# Build
docker build -t servana-backend .

# Run
docker-compose up
```

## License

ISC
