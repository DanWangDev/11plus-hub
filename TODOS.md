# TODOS

## Phase A: Hub Core (in progress)

### P0: OIDC Provider + Backend API [done]

- PostgreSQL schema: users, applications, subscriptions, user_app_access, service_tokens, learning_events, audit_log, password_reset_tokens, oidc_payloads
- Express API with routes: auth (register/login), users (CRUD), applications (registry), subscriptions, audit log, password reset
- OIDC provider (panva/oidc-provider) with custom PostgreSQL adapter
- OIDC interaction routes (login/consent flow)
- Rate limiting on auth and API endpoints
- Health/readiness checks with DB connectivity
- Structured logging, request ID tracking, error handling
- CI/CD pipeline (lint, typecheck, test, build, Docker)

### P0: Auth UI + Frontend SPA [done]

- React SPA (Vite + React 19 + Tailwind CSS 4) with login, signup, forgot/reset password, dashboard
- Username or email login support
- Role-based routing (admin -> /admin, student/parent -> /dashboard)
- Auth context with localStorage persistence
- Frontend built into Docker image (multi-stage Dockerfile)
- Auto-migrations and auto-seeding on container startup
- Admin credentials via env vars (no hardcoded defaults)

### P0: Admin Panel [done]

- User management: search, filter by role, inline edit (display_name, email, role)
- App registry: create apps, view/rotate client credentials, inline edit (name, URL, status, redirect URIs)
- Subscription management: assign plans, inline edit (plan, status, features), filter by plan/status
- Audit log: read-only view with action type filter, pagination
- _Remaining:_ user impersonation (read-only, audit-logged, 30-min timeout)

### P0: `@labf/auth-client` SDK [done]

- Published as standalone repo: https://github.com/DanWangDev/auth-client
- OIDC client wrapper for GitHub Packages under `@labf` scope
- Express middleware + browser helpers, token storage, refresh, JWKS validation

### P0: Google OAuth on Hub [done]

- Backend: google-auth-library for ID token + access token verification
- Frontend: @react-oauth/google with Google Sign-In button on login and signup
- Account linking: existing email users auto-linked when signing in with Google
- New Google users auto-created with student role
- Env var: GOOGLE_CLIENT_ID (optional, feature disabled if not set)

### P0: Turnstile Bot Protection [done]

- Backend: Cloudflare Turnstile token verification on register, login, and Google auth endpoints
- Frontend: @marsidev/react-turnstile invisible widget on login and signup forms
- Graceful degradation: disabled when TURNSTILE_SECRET_KEY not configured
- Env vars: TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY (optional)

### P0: Cloudflare Tunnel + Deployment [done]

- Configured on Cloudflare dashboard (no app-level code needed)

### P0: Hub OIDC Self-Client + Back-Channel Logout [planned]

- **What:** Make the hub use its own OIDC provider for login. Register hub as an OIDC client in the applications table. Add Google OAuth to the OIDC interaction login page. Enable back-channel logout for instant session propagation to client apps.
- **Why:** Cross-tab login doesn't persist because the hub uses localStorage-based direct auth instead of OIDC sessions. Client apps can't SSO because the hub never creates an OIDC session. Two disconnected auth systems (direct auth vs OIDC) — this unifies them.
- **Effort:** M (human: ~1 week / CC: ~45 min)
- **Depends on:** Phase A P0 items (all done). Blocks Phase B app migrations.
- **Context:**
  - Root cause: `POST /api/auth/login` returns a placeholder JWT with no server session. OIDC interaction login creates proper sessions but the hub frontend doesn't use it.
  - Hub frontend `AuthContext` switches from localStorage to httpOnly cookie (fetch `/auth/me`). Hub uses `@danwangdev/auth-client` SDK like other apps.
  - Google OAuth appears in both registration page and OIDC interaction login page (all apps benefit).
  - Back-channel logout: enable `features.backchannelLogout` in oidc-provider. Add `backchannel_logout_uri` column to applications table. oidc-provider sends signed `logout_token` JWT to each client on session destroy.
  - `POST /api/auth/login` deprecated. `/api/auth/google` stays as backend handler for both registration and OIDC interaction.
  - Back-channel logout failures logged but don't block hub logout (resilience). Client apps fall back to token expiry.

### P0: Auth-Client SDK Back-Channel Logout Support [planned]

- **What:** Add `POST /auth/backchannel-logout` route to `@danwangdev/auth-client` SDK. Verifies `logout_token` JWT from oidc-provider via JWKS, finds the session for that user, and destroys the iron-session.
- **Why:** Back-channel logout requires each client app to have a logout endpoint. Building it into the SDK means vocab-master and writing-buddy get it for free.
- **Effort:** S (human: ~1 day / CC: ~15 min)
- **Depends on:** Hub OIDC Self-Client + Back-Channel Logout TODO above.
- **Context:** oidc-provider sends a signed JWT with `sub` claim. SDK endpoint verifies signature via JWKS, matches session by `sub`, and destroys it. Version bump to auth-client needed. Apps must update dependency.

## Phase B: App Migrations (planned)

### P1: Migrate Vocab-Master to Hub Auth

- **What:** Strip auth code from vocab-master, install `@labf/auth-client` SDK, redirect to hub for login. Keep SQLite for domain data.
- **Effort:** S (human: ~2 days / CC: ~30 min)
- **Depends on:** Phase A complete
- **Context:**
  - Delete: authService, googleAuthService, auth middleware, turnstile middleware, auth routes, userRepository, tokenRepository, passwordResetRepository
  - Add: `@labf/auth-client` SDK middleware, lightweight `app_users` table (hub_user_id + app-specific prefs)
  - Lazy user sync: valid JWT -> check if local app_users record exists -> create if not
  - Run full test suite before merging (high-risk change to a production app)

### P1: Migrate Writing-Buddy to Hub Auth

- **What:** Strip standalone auth, install `@labf/auth-client` SDK, recreate DB schema with hub_user_id references.
- **Effort:** S (human: ~1 day / CC: ~20 min)
- **Depends on:** Phase A complete
- **Context:** Clean slate (no production data). Delete auth-service.ts, auth middleware, auth routes, user-repository.ts.

### P1: User Data Migration Script [done]

- Export vocab-master users to hub PostgreSQL. Password hashes (bcrypt) are portable.

## Phase C: Expansions (planned)

### P1: Hub DESIGN.md

- **What:** Extract the design system from `docs/designs/hub-idp-app.md` into a standalone `DESIGN.md`.
- **Context:** Inter typography, slate neutrals, wireframes, interaction states, responsive specs, accessibility.

### P1: Hub Resilience Hardening

- **What:** Address 3 failure mode gaps: (1) SSO cookie blocking detection, (2) concurrent token refresh race condition, (3) OIDC signing key loss protection.
- **Context:**
  - Cookie blocking: detect SSO failure on client side, fall back to explicit login redirect (Safari ITP, privacy browsers).
  - Token refresh race: refresh token rotation with 30-second grace period.
  - Signing key protection: startup health check that verifies `OIDC_SIGNING_KEY` can sign/verify.

### P1: Email Notifications via Resend

- **What:** Resend integration for welcome, password reset, subscription changes.

## Phase D: Cross-app Intelligence (planned)

### P2: Learning Events API

- **What:** Hub-side storage + REST endpoint for apps to push learning events (fire-and-forget).
- **Context:** DB table exists (learning_events). Apps authenticate with service-to-service tokens.

### P2: Parent Dashboard

- **What:** Cross-app progress aggregation. Hub calls each app's stats API endpoint.
- **Context:** Per-app stat blocks with 2-3 key numbers each.

### P2: Stripe Billing Integration

- **What:** Stripe Checkout for new subscriptions, Customer Portal for management, webhook handler for lifecycle events.
- **Effort:** M (human: ~1 week / CC: ~45 min)
- **Depends on:** Phase B stable, subscription types and admin assignment working first.

### P3: Weekly Parent Email Digest

- **What:** Automated weekly email summarizing child's progress across all apps.
- **Depends on:** Phase C (Resend) + Phase D (parent dashboard)
- **Context:** Resend scheduled send or cron. Unsubscribe link required. Only send if child had activity.
