# Architecture

## Overview

11plus-hub is the platform identity provider for the Lab F 11+ learning suite. It provides OIDC-based SSO so that child apps (vocab-master, writing-buddy, story-sleuth) delegate all authentication to a single hub. Each app remains fully independent (own repo, own DB, own CI/CD) and authenticates users via standard OIDC Authorization Code + PKCE.

## OIDC Flow

```
1. User visits vocab-master.labf.app
2. App redirects to hub.labf.app/oidc/auth (Authorization Code + PKCE)
3. Hub checks session cookie (Domain=.labf.app)
   - If valid session: issue authorization code immediately (silent SSO)
   - If no session: show login page
4. User authenticates (email/password or Google ID token)
5. Hub issues authorization code, redirects back to app callback
6. App exchanges code for access token + refresh token via hub /oidc/token
7. App validates JWT locally (JWKS from hub /oidc/jwks)
8. Access token (15 min) contains claims: sub, email, username, role, plan, apps, features
9. On expiry, app uses refresh token (7 day) to get new access token
```

The hub also uses its own provider ("self-client") for its own SPA login via `/api/auth/hub-login` → `/api/auth/hub-callback`, with the session kept in an iron-session cookie (`__hub_session`).

SSO works because the hub session cookie is set on `.labf.app`, so a user logged into one app is automatically recognized by the hub when a second app redirects there.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js 24 (Alpine) | Matches existing apps |
| Server | Express 5 | Familiar, lightweight |
| Language | TypeScript (strict) | Type safety across stack |
| Database | PostgreSQL 17 via postgres.js (shared `labf-db`) | Relational data (users, subscriptions, OIDC sessions) |
| OIDC | oidc-provider (panva) | Certified OpenID Connect provider |
| Frontend | React 19 + Vite + Tailwind 4 | Matches writing-buddy/vocab-master |
| Billing | Stripe (checkout, portal, webhooks) | Subscriptions (Phase 1: single writing plan) |
| Bot protection | Cloudflare Turnstile | Login/signup/interaction endpoints |
| Validation | Zod | Runtime + compile-time safety |
| Testing | Vitest + Supertest (+ Testing Library on the frontend) | Fast, ESM-native |
| Deploy | Docker Compose + Cloudflare Tunnel, GHCR images | Same pattern as other apps |

## Database Schema

19 migration files in `packages/backend/src/db/migrations/`. Core tables:

### Identity
```
users
  id SERIAL PK, username UNIQUE, email UNIQUE, password_hash (nullable for Google-only),
  display_name, role (student|parent|admin), parent_id FK, google_id UNIQUE,
  email_verified, created_at, updated_at, deleted_at (soft delete), last_active_at
```

### OIDC
```
oidc_payloads
  id TEXT, type TEXT, payload JSONB, grant_id, user_code, uid,
  expires_at, consumed_at, created_at
  -- Single-table adapter for oidc-provider (sessions, tokens, codes, grants)
  -- Expired rows are purged hourly by jobs/oidc-cleanup.ts
```

### Application Registry
```
applications
  id SERIAL PK, name, slug UNIQUE, url, client_id UNIQUE,
  client_secret_sha256 (SHA-256 at rest — oidc-provider compares hashes),
  client_secret_hash (legacy bcrypt column, unused), redirect_uris TEXT[],
  icon_url, stats_api_url, backchannel_logout_uri, status, created_at
```

### Subscriptions & Billing
```
subscriptions
  id SERIAL PK, user_id FK, plan (free|writing|vocab|bundle|family),
  status (active|trial|expired|cancelled|past_due|incomplete), features TEXT[],
  expires_at, assigned_by FK (admin), stripe_customer_id UNIQUE,
  stripe_subscription_id UNIQUE, created_at

user_app_access
  user_id FK, app_id FK, granted_at -- populated from subscription plan

stripe_processed_events
  event_id UNIQUE -- webhook idempotency
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
  -- Table exists; ingest API not yet shipped

audit_log
  id SERIAL PK, actor_id FK, action, target_id, details JSONB, ip_address, created_at
```

### Password Reset & BCL
```
password_reset_tokens
  id SERIAL PK, user_id FK, selector UNIQUE, validator_hash, expires_at, created_at

bcl_retry_queue
  id SERIAL PK, account_id, sid, client_id, status, attempts, next_attempt_at, ...
  -- Retries failed backchannel-logout deliveries with backoff
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
| POST | `/api/auth/register` | Create account (rate limited + Turnstile) |


| GET | `/api/auth/hub-login` | Hub's own OIDC login redirect (PKCE + state) |
| GET | `/api/auth/hub-callback` | OIDC callback → iron-session |
| GET/POST | `/api/auth/hub-logout` | Clear session + OIDC end_session redirect |
| GET | `/api/auth/me` | Current claims from session (401 when anonymous) |
| GET | `/api/auth/refresh` | Refresh id_token claims via refresh_token exchange |
| POST | `/api/auth/backchannel-logout` | Hub's own BCL receiver (verifies logout_token) |

### OIDC Interactions (the real SSO login path — JSON API for the SPA)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/interaction/:uid` | Interaction details (login/consent) |
| POST | `/api/auth/interaction/:uid/login` | Password login (rate limited + Turnstile) |
| POST | `/api/auth/interaction/:uid/google` | Google ID-token login (Turnstile; verified-email linking only) |
| POST | `/api/auth/interaction/:uid/confirm` | Grant consent |
| POST | `/api/auth/interaction/:uid/abort` | Deny interaction |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List users (admin) |
| GET | `/api/users/:id` | Get user by ID |
| POST | `/api/users` | Create user (admin) |
| PATCH | `/api/users/:id` | Update user (admin) |
| DELETE | `/api/users/:id` | Soft delete (admin) |

### Impersonation (admin)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/impersonate` | Start (read-only mode, 30-min session, audit-logged) |
| POST | `/api/admin/impersonate/end` | End |

### Applications (Registry)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/apps` | List registered apps (any authenticated user) |
| POST | `/api/apps` | Register app (admin) |
| GET | `/api/apps/:id` | Get app details |
| PATCH | `/api/apps/:id` | Update app (admin) |
| DELETE | `/api/apps/:id` | Soft delete (admin) |
| POST | `/api/apps/:id/rotate-secret` | Rotate client secret (admin) |
| POST | `/api/apps/:id/service-tokens` | Create service token (admin) |
| DELETE | `/api/apps/:id/service-tokens/:tokenId` | Revoke service token (admin) |

### Subscriptions
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/subscriptions` | Create subscription (admin) |
| GET | `/api/subscriptions/user/:userId` | Get user's subscription |
| PATCH | `/api/subscriptions/:id` | Update subscription (admin; re-syncs app access on plan/status changes) |

### Billing (Stripe — enabled when STRIPE_* env vars are set)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/stripe/checkout` | Create Checkout Session (authenticated user) |
| POST | `/api/stripe/portal` | Create Customer Portal Session (authenticated user) |
| POST | `/api/stripe/webhook` | Raw-body webhook (signature verified, idempotent, transactional) |

### Entitlement (service-to-service)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/entitlement?user_id=N` | Bearer service-token check of a user's access to the caller's app |

### Password Reset
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/forgot-password` | Request reset (rate limited; email delivery not yet wired) |
| POST | `/api/auth/reset-password` | Reset with selector + validator |

### Profile (Self-Service)
| Method | Path | Description |
|--------|------|-------------|
| PATCH | `/api/profile` | Update own display name (authenticated) |
| PATCH | `/api/profile/password` | Change own password (authenticated) |

### Audit
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audit` | Query audit log (admin) |
| GET | `/api/audit/actor/:actorId` | Audit trail for a specific actor (admin) |

### OIDC (via oidc-provider)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/oidc/auth` | Authorization endpoint |
| POST | `/oidc/token` | Token endpoint (rate limited: 60/min/client) |
| GET | `/oidc/userinfo` | User info endpoint |
| GET | `/oidc/.well-known/openid-configuration` | Discovery document (also mirrored at `/.well-known/`) |
| GET | `/oidc/jwks` | JSON Web Key Set |

## Project Structure

```
packages/
  backend/
    src/
      config/env.ts          -- Zod-validated env; production fails fast on missing/default secrets
      db/
        connection.ts        -- postgres.js connection
        migrator.ts          -- SQL migration runner
        migrate.ts           -- CLI migration entry point
        migrate-users.ts     -- Vocab-master user import script (one-off)
        migrate-writing-buddy.ts -- Writing-buddy user import + data remap (one-off)
        seed.ts              -- Idempotent startup bootstrap: admin user + hub self-client;
                                demo data only when SEED_ON_STARTUP=true
        migrations/          -- 19 SQL migration files (001–019)
      jobs/oidc-cleanup.ts   -- Hourly purge of expired oidc_payloads + failed BCL rows
      lib/logger.ts          -- Structured JSON logger
      middleware/
        auth.ts              -- requireAuth/requireAdmin via iron-session cookie
        error-handler.ts     -- Centralized error handling + 404
        rate-limit.ts        -- Per-route rate limiting (login/register/reset/profile/api)
        request-id.ts        -- X-Request-ID tracking
      oidc/
        provider.ts          -- oidc-provider configuration (PKCE required, auto-consent
                                for first-party clients, backchannel logout, event handlers)
        pg-adapter.ts        -- Custom PostgreSQL adapter for oidc-provider (+60s client cache)
        account.ts           -- Account model / claims assembly (auto-syncs app access)
        client-loader.ts     -- Static client loading + timing-safe secret verify
        secret-auth-middleware.ts -- Hashes incoming client_secret before oidc-provider sees it
        bcl-retry.ts         -- Backchannel logout retry queue with backoff
        dev-keys.ts          -- Development signing key generator (warns in production)
        entitlement-check.ts -- Entitlement gate used by the interaction login
      routes/
        health.ts, auth.ts, users.ts, applications.ts, subscriptions.ts,
        password-reset.ts, profile.ts, audit.ts, oidc-interactions.ts,
        hub-auth.ts, impersonate.ts, stripe-webhook.ts, stripe-checkout.ts,
        entitlement.ts
      services/
        user-service.ts, app-service.ts, subscription-service.ts,
        audit-service.ts, password-reset-service.ts, stripe-service.ts,
        google-auth-service.ts, turnstile-service.ts, registry-cors.ts
      app.ts               -- Express app factory (DI-friendly, helmet/CORS/rate-limit wiring)
      server.ts            -- Server entry point (loads registry CORS allowlist at startup)
  frontend/                -- React SPA
    src/
      pages/               -- Login (OIDC redirect), Signup, Forgot/ResetPassword,
                             Interaction, Dashboard, Pricing, Admin pages
      components/          -- AuthLayout, GoogleSignInButton (GIS credential flow),
                             TurnstileWidget, SubscriptionCard, TrialBanner,
                             PaymentSuccessOverlay, ImpersonationBanner, ui/
      api/                 -- API client
      contexts/            -- AuthContext (cookie-based /api/auth/me)
      hooks/               -- React hooks
```

## Security Model

- **Secrets:** production refuses to boot with development defaults — `HUB_SESSION_SECRET`, `OIDC_COOKIE_KEYS`, `OIDC_SIGNING_KEY`, `HUB_CLIENT_SECRET`, `DB_PASSWORD` must all be explicitly set (and not equal to dev defaults) when `NODE_ENV=production`.
- **Client secrets:** stored as SHA-256 hashes; the token endpoint hashes incoming plaintext before oidc-provider compares (IdentityServer pattern). bcrypt column is legacy.
- **Sessions:** iron-session (`__hub_session`) for the hub SPA; oidc-provider cookies signed with `OIDC_COOKIE_KEYS`. All `HttpOnly`, `SameSite=Lax`, `Secure` in production.
- **Bot protection:** Turnstile on register, legacy login, and both OIDC interaction endpoints; dedicated rate limiters per route class.
- **Google auth:** only ID tokens are accepted (audience-checked); access tokens are rejected. Account linking by email requires `email_verified=true` on the Google side.
- **CORS:** explicit allowlist built from the application registry (no wildcards). oidc-provider uses `clientBasedCORS` against registered redirect URIs.
- **Impersonation:** admin-only, audit-logged, 30-minute cookie, read-only mode enforced by middleware, identity swapped in claims.
- **Webhooks:** Stripe signature verification, idempotency table, transactional updates. Unknown Stripe statuses are a no-op (fail safe, never grant).
- **Audit:** all admin actions attributed to the verified session user (never client headers).

## Delivery Phases

| Phase | Status | What |
|-------|--------|------|
| A | ✅ done | Hub core: OIDC provider, auth UI, app registry, SDK, deployment, admin panel, impersonation, Google OAuth, Turnstile, Cloudflare Tunnel, hub self-client + BCL, profile self-service |
| 1 | ✅ mostly done | Revenue pipeline: Stripe checkout/portal/webhooks, pricing page, trial banner, payment-success overlay, subscription card, entitlement API, bug fixes. Remaining: paywall decision (see TODOS), trial-expiry banner polish |
| B | done | App migrations: vocab-master, writing-buddy, story-sleuth on `@danwangdev/auth-client` |
| C | planned | Email (Resend), hub resilience hardening |
| D | planned | Cross-app intelligence: learning events ingest, parent dashboard |

## Key Design Decisions

- **User schema:** INTEGER IDs, username-based (adopted from vocab-master). Email is required for password reset and Google OAuth linking.
- **Each app owns its own DB.** Hub owns identity. The hub and story-sleuth share the `labf-db` PostgreSQL instance (separate databases); vocab-master/writing-buddy still run SQLite.
- **OIDC adapter:** Single `oidc_payloads` table with a `type` column, rather than separate tables per token type. Simpler schema, easier cleanup.
- **Session cookie:** `Domain=.labf.app`, HttpOnly, Secure, SameSite=Lax. All apps must be on `*.labf.app` subdomains for SSO to work.
- **Subscriptions:** Admin-assigned or Stripe-managed. Entitlements are derived from `user_app_access`, kept in sync from the plan (single atomic CTE), and self-heal on token issuance.
- **Learning events:** Fire-and-forget from apps to hub (table exists; ingest API planned).
- **Shared Docker network:** All app backends join `labf-net`, an external Docker bridge created once per host via `bootstrap.sh` (owned by labf-infra; idempotent copies kept in app repos). Backends reach each other by container name (e.g., `hub-backend:3009`) for OIDC discovery, JWKS, back-channel logout, and stats API calls. Only backends join — databases stay on app-private networks.

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
```

**Network rules:**
- `labf-net` is `external: true` in every compose file — create it via `labf-infra/bootstrap.sh` (idempotent)
- The hub backend's host port is bound to `127.0.0.1` in production — the frontend nginx reaches it over the compose network; LAN devices cannot hit the API directly (which would let them spoof `X-Forwarded-*` and bypass IP-based rate limits)
- Only backends join `labf-net`; databases and frontends stay on private networks
- Backends use `OIDC_INTERNAL_ISSUER=http://hub-backend:3009` for internal OIDC calls
- Browser-facing URLs still use the public domain (`https://hub.labf.app`)

## Continuous Delivery

- **CI** (`.github/workflows/ci.yml`, push + PR): lint, format check, typecheck, backend tests with 80% coverage thresholds, **frontend tests with coverage**, build; docker images for backend + frontend built and pushed to GHCR on main.
- **CD** (`.github/workflows/deploy.yml.disabled`): deploy-on-CI-success via the NAS self-hosted runner is currently **disabled** (runner not yet set up). Deploys are manual via `deploy.sh` (pull → down → up). Re-enable once the `nas` runner is registered; add a post-deploy health check at the same time.
- **Production boot:** `migrate` (no advisory lock yet — single container) → `seed` (admin + hub self-client bootstrap only; demo data gated behind `SEED_ON_STARTUP`) → server.
- **Deploy prerequisite:** `.env` must contain real `HUB_SESSION_SECRET`, `OIDC_COOKIE_KEYS`, `OIDC_SIGNING_KEY`, `HUB_CLIENT_SECRET`, `DB_PASSWORD` — the app fails fast otherwise.

## Auth Client SDK (`@danwangdev/auth-client`)

Standalone repo, published and consumed by vocab-master, writing-buddy, and story-sleuth (v0.3.1). Provides server middleware, browser helpers, JWT verification via JWKS, refresh handling, and a backchannel-logout route.
