# 11plus Hub

Platform Identity Provider for the 11+ learning suite. Provides OIDC-based SSO, application registry, subscription management, cross-app learning profiles, and a parent dashboard — all from a single hub.

## Architecture

```
                    OIDC Authorization Code + PKCE

┌──────────────────────────────────────────────────────────┐
│  hub.labf.app                                             │
│  Express + React + postgres.js + oidc-provider            │
│                                                           │
│  OWNS:                                                    │
│  ├── Identity: users, passwords, Google OAuth, Turnstile  │
│  ├── OIDC Provider: authorize, token, userinfo, jwks      │
│  ├── Application Registry: client_id/secret, redirects    │
│  ├── Subscriptions: plans, entitlements, feature gates     │
│  ├── Learning Profiles: cross-app events + metadata       │
│  ├── Email: Resend (welcome, reset, subscription)         │
│  ├── Admin Panel: user mgmt, audit logs, impersonation    │
│  ├── Parent Dashboard: cross-app progress aggregation     │
│  └── App Dashboard: launcher for user's apps              │
│                                                           │
│  PostgreSQL (own container)                               │
│  Cloudflare Tunnel → HTTPS                                │
└──────────────────────────────────────────────────────────┘
                          │ OIDC
       ┌──────────────────┼──────────────────┐
       ▼                  ▼                  ▼
 vocab-master       writing-buddy        future apps
 @labf/auth-client  @labf/auth-client    @labf/auth-client
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 (Alpine) |
| Server | Express 5 |
| Language | TypeScript 5.8 (strict mode) |
| Database | PostgreSQL 17 via postgres.js |
| Auth | oidc-provider (panva) |
| Validation | Zod |
| Testing | Vitest + Supertest |
| Linting | ESLint 9 (flat config) + Prettier |
| Container | Docker (multi-stage) |
| CI/CD | GitHub Actions → GHCR |

## Quick Start

### Prerequisites

- Node.js >= 20
- Docker & Docker Compose
- Git

### Setup

```bash
# Clone
git clone https://github.com/DanWangDev/11plus-hub.git
cd 11plus-hub

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Start PostgreSQL
docker compose up db -d

# Run in development mode
npm run dev
```

### Available Scripts

| Script | Description |
|--------|------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript + build frontend |
| `npm start` | Run production build |
| `npm run lint` | ESLint check (zero warnings) |
| `npm run format:check` | Prettier check |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage (80% threshold) |
| `npm run docker:up` | Start all services via Docker Compose |
| `npm run docker:down` | Stop all services |
| `npm run ci` | Run full CI pipeline locally |

### Docker

```bash
# Full stack (app + database)
docker compose up

# Just the database
docker compose up db -d

# Build production image
docker build --target production -t hub .
```

## Project Structure

```
src/
├── config/          # Environment and app configuration
│   └── env.ts       # Zod-validated environment variables
├── db/              # Database migrations and seed data
│   └── migrations/  # SQL migration files
├── middleware/       # Express middleware
│   ├── error-handler.ts  # Centralized error handling
│   └── request-id.ts     # Request ID tracking
├── routes/          # Route handlers
│   └── health.ts    # Health & readiness checks
├── services/        # Business logic
├── types/           # TypeScript type definitions
│   └── api.ts       # Shared API response types
├── test/            # Test utilities and fixtures
├── app.ts           # Express app factory
└── server.ts        # Server entry point
```

## API Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (status, version, uptime) |
| GET | `/ready` | Readiness check (database connectivity) |

## CI/CD Pipeline

The GitHub Actions pipeline runs on every push and PR to `main`:

1. **Lint & Format** — ESLint (zero warnings) + Prettier check
2. **Type Check** — TypeScript strict mode compilation
3. **Test** — Vitest with 80% coverage threshold
4. **Build** — TypeScript compilation + frontend build
5. **Docker** — Build and push to GHCR (main branch only)

## Development Workflow

1. Create a feature branch from `main`
2. Implement changes with tests
3. Open a PR — CI runs automatically
4. Fix any lint/test/build issues
5. Merge after review

## Delivery Phases

- **Phase A** — Hub Core: OIDC provider, auth UI, app registry, app dashboard, SDK
- **Phase B** — App Migrations: migrate vocab-master and writing-buddy
- **Phase C** — Expansions: email (Resend), admin panel, subscriptions
- **Phase D** — Cross-app Intelligence: learning events, parent dashboard

## License

Private — Lab F
