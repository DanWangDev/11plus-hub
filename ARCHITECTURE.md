# Architecture

## Overview

11plus-hub is the platform identity provider for the Lab F 11+ learning suite. It provides OIDC-based SSO so that child apps (vocab-master, writing-buddy, future apps) delegate all authentication to a single hub. Each app remains fully independent (own repo, own DB, own CI/CD) and authenticates users via standard OIDC Authorization Code + PKCE.

## OIDC Flow

```
1. User visits vocab-master.labf.app
2. App redirects to hub.labf.app/oidc/auth (Authorization Code + PKCE)
3. Hub checks session cookie (Domain=.labf.app)
   - If valid session: issue authorization code immediately (silent SSO)
   - If no session: show login page
4. User authenticates (email/password or Google OAuth)
5. Hub issues authorization code, redirects back to app callback
6. App exchanges code for access token + refresh token via hub /oidc/token
7. App validates JWT locally (JWKS from hub /oidc/jwks)
8. Access token (15 min) contains claims: sub, email, username, role, plan, apps, features
9. On expiry, app uses refresh token (7 day) to get new access token
```

SSO works because the hub session cookie is set on `.labf.app`, so a user logged into one app is automatically recognized by the hub when a second app redirects there.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js 20 | Matches existing apps |
| Server | Express 5 | Familiar, lightweight |
| Language | TypeScript (strict) | Type safety across stack |
| Database | PostgreSQL 17 via postgres.js | Relational data (users, subscriptions, OIDC sessions) |
| OIDC | oidc-provider (panva) | Certified OpenID Connect provider |
| Frontend | React + Vite + Tailwind | Matches writing-buddy/vocab-master |
| Validation | Zod | Runtime + compile-time safety |
| Testing | Vitest + Supertest | Fast, ESM-native |
| Deploy | Docker Compose + Cloudflare Tunnel | Same pattern as other apps |

## Database Schema

9 migration files in `src/db/migrations/`. Core tables:

### Identity
```
users
  id SERIAL PK, username UNIQUE, email UNIQUE, password_hash (nullable for Google-only),
  display_name, role (student|parent|admin), parent_id FK, google_id UNIQUE,
  email_verified, created_at, updated_at (auto-trigger)
```

### OIDC
```
oidc_payloads
  id TEXT, type TEXT, payload JSONB, grant_id, user_code, uid,
  expires_at, consumed_at, created_at
  -- Single-table adapter for oidc-provider (sessions, tokens, codes, grants)
```

### Application Registry
```
applications
  id SERIAL PK, name, slug UNIQUE, url, client_id UNIQUE, client_secret_hash (bcrypt),
  redirect_uris TEXT[], icon_url, stats_api_url, status, created_at
```

### Subscriptions
```
subscriptions
  id SERIAL PK, user_id FK, plan (free|writing|vocab|bundle|family),
  status (active|trial|expired|cancelled), features TEXT[], expires_at,
  assigned_by FK (admin), created_at

user_app_access
  user_id FK, app_id FK, granted_at -- populated from subscription plan
```

### Service-to-Service Auth
```
service_tokens
  id SERIAL PK, app_id FK, token_hash (SHA256), scopes TEXT[],
  expires_at, created_at
```

### Analytics & Audit
```
learning_events
  id SERIAL PK, user_id FK, app_id FK, event_type, metadata JSONB, created_at

audit_log
  id SERIAL PK, actor_id FK, action, target_id, details JSONB, ip_address, created_at
```

### Password Reset
```
password_reset_tokens
  id SERIAL PK, user_id FK, selector UNIQUE, validator_hash, expires_at, created_at
```

## API Endpoints

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Status, version, uptime |
| GET | `/ready` | Database connectivity check |

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account (rate limited: 3/hr/IP) |
| POST | `/api/auth/login` | Email/password login (rate limited: 5/15min/IP) |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List users (admin) |
| GET | `/api/users/:id` | Get user by ID |
| PATCH | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Delete user |

### Applications (Registry)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/applications` | Register app (admin) |
| GET | `/api/applications` | List registered apps |
| GET | `/api/applications/:id` | Get app details |
| PATCH | `/api/applications/:id` | Update app |
| DELETE | `/api/applications/:id` | Remove app |

### Subscriptions
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/subscriptions` | Create subscription (admin) |
| GET | `/api/subscriptions/user/:userId` | Get user's subscription |
| PATCH | `/api/subscriptions/:id` | Update subscription |

### Password Reset
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/forgot-password` | Request reset email |
| POST | `/api/auth/reset-password` | Reset with token |

### Profile (Self-Service)
| Method | Path | Description |
|--------|------|-------------|
| PATCH | `/api/profile` | Update own display name (authenticated) |
| PATCH | `/api/profile/password` | Change own password (authenticated) |

### Audit
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audit` | Query audit log (admin) |

### OIDC (via oidc-provider)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/oidc/auth` | Authorization endpoint |
| POST | `/oidc/token` | Token endpoint (rate limited: 60/min/client) |
| GET | `/oidc/userinfo` | User info endpoint |
| GET | `/oidc/.well-known/openid-configuration` | Discovery document |
| GET | `/oidc/jwks` | JSON Web Key Set |
| GET | `/auth/interaction/:uid` | Login/consent interaction page |
| POST | `/auth/interaction/:uid/login` | Submit login during interaction |
| POST | `/auth/interaction/:uid/confirm` | Confirm consent |

## Project Structure

```
src/
  config/env.ts          -- Zod-validated environment variables
  db/
    connection.ts        -- postgres.js connection
    migrator.ts          -- SQL migration runner
    migrate.ts           -- CLI migration entry point
    migrate-users.ts     -- Vocab-master user import script
    migrate-writing-buddy.ts -- Writing-buddy user import + data remap
    seed.ts              -- Development seed data
    migrations/          -- 9 SQL migration files
  lib/logger.ts          -- Structured logger (pino-style)
  middleware/
    error-handler.ts     -- Centralized error handling + 404
    request-id.ts        -- X-Request-ID tracking
    rate-limit.ts        -- Per-route rate limiting
  oidc/
    provider.ts          -- oidc-provider configuration
    pg-adapter.ts        -- Custom PostgreSQL adapter for oidc-provider
    account.ts           -- Account model for oidc-provider claims
    client-loader.ts     -- Load OIDC clients from applications table
    dev-keys.ts          -- Development signing keys
  routes/
    health.ts            -- /health, /ready
    auth.ts              -- /api/auth/register, /api/auth/login
    users.ts             -- /api/users CRUD
    applications.ts      -- /api/applications CRUD
    subscriptions.ts     -- /api/subscriptions
    password-reset.ts    -- /api/auth/forgot-password, /api/auth/reset-password
    profile.ts           -- /api/profile (display name), /api/profile/password (password change)
    audit.ts             -- /api/audit
    oidc-interactions.ts -- /auth/interaction/:uid (login/consent UI)
  services/
    user-service.ts      -- User CRUD, password hashing, validation
    app-service.ts       -- Application registry operations
    subscription-service.ts -- Plan management, entitlements
    audit-service.ts     -- Audit log writes and queries
    password-reset-service.ts -- Token generation, validation, reset
  types/
    api.ts               -- ApiResponse<T>, error types
    express.d.ts         -- Express request augmentation
    oidc-provider.d.ts   -- oidc-provider type overrides
  app.ts                 -- Express app factory
  server.ts              -- Server entry point

packages/
  frontend/              -- React SPA
    src/
      pages/             -- Login, Signup, ForgotPassword, ResetPassword, Interaction, Dashboard, Admin
      components/        -- AuthLayout, DashboardLayout, ProfileCard, UserMenu, EditProfileModal, ui/
      api/               -- API client
      hooks/             -- React hooks
```

## Auth Client SDK (`@labf/auth-client`)

Not yet published. Will be a ~100-line OIDC client wrapper providing:

```typescript
// Backend (Express middleware)
createAuthMiddleware({ issuer, clientId, clientSecret, redirectUri, postLogoutUri })
auth.callback()      // OIDC callback handler
auth.login()         // Redirect to hub login
auth.logout()        // Logout + redirect
auth.requireAuth()   // Protect routes (401 if no valid session)
auth.optionalAuth()  // Attach user if present

// Frontend (browser helpers)
getLoginUrl(), getLogoutUrl(), isAuthenticated()
```

The SDK stores tokens in encrypted httpOnly session cookies on the app's domain. JWT validation is local (JWKS). Token refresh is transparent to route handlers.

## Delivery Phases

| Phase | Status | What |
|-------|--------|------|
| A | In progress | Hub core: OIDC provider, auth UI, app registry, SDK, deployment |
| B | Planned | App migrations: vocab-master + writing-buddy switch to hub auth |
| C | Planned | Expansions: email (Resend), admin panel, subscription assignment |
| D | Planned | Cross-app intelligence: learning events API, parent dashboard |

## Key Design Decisions

- **User schema:** INTEGER IDs, username-based (adopted from vocab-master). Email is required for password reset and Google OAuth linking.
- **Each app owns its own DB.** Hub owns identity. No shared database between apps.
- **OIDC adapter:** Single `oidc_payloads` table with a `type` column, rather than separate tables per token type. Simpler schema, easier cleanup.
- **Session cookie:** `Domain=.labf.app`, HttpOnly, Secure, SameSite=Lax. All apps must be on `*.labf.app` subdomains for SSO to work.
- **Subscriptions:** Admin-assigned in Phase 1. Stripe self-service deferred until SSO is stable.
- **Learning events:** Fire-and-forget from apps to hub. Acceptable event loss at current scale.
- **Shared Docker network:** All app backends join `labf-net`, an external Docker bridge created once per host via `bootstrap.sh` (kept in this repo). Hub owns the network bootstrap; each consumer app also carries an idempotent copy for self-service setup. Backends reach each other by container name (e.g., `hub-backend:3009`) for OIDC discovery, JWKS, back-channel logout, and stats API calls. Only backends join — databases stay on app-private networks.

## Deployment Architecture

```
                    labf-net (shared, external)
                   ┌──────────────────────────┐
                   │                          │
    hub-backend ───┤    vocab-master-backend ─┼── vocab-master-network
    (port 3009)    │    (port 9876)           │   (db + frontend)
                   │                          │
    writing-buddy──┤    story-sleuth-backend ─┼── story-sleuth default
    backend        │    (port 5060)           │   (db + frontend)
    (port 5050)    │                          │
                   └──────────────────────────┘

    Each app's internal network:
    ┌─ hub ──────────────┐  ┌─ vocab-network ───┐
    │ db, backend,       │  │ db, backend,       │
    │ frontend           │  │ frontend           │
    └────────────────────┘  └────────────────────┘
```

**Network rules:**
- `labf-net` is `external: true` in every compose file — it must exist before `docker compose up`
- Create it with `./bootstrap.sh` (idempotent, safe to re-run)
- Only backends join `labf-net`; databases and frontends stay on private networks
- Backends use `OIDC_INTERNAL_ISSUER=http://hub-backend:3009` for internal OIDC calls
- Browser-facing URLs still use the public domain (`https://hub.labf.app`)
