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

### P0: Auth UI + Frontend SPA [in progress]
- **Status:** IN PROGRESS (branch: `feat/frontend-spa`)
- **What:** React SPA with login, signup, forgot/reset password, OIDC interaction page, app dashboard
- **Context:** Vite + React + Tailwind, pages scaffolded (LoginPage, SignupPage, ForgotPasswordPage, ResetPasswordPage, InteractionPage, DashboardPage)

### P0: Google OAuth on Hub [planned]
- **What:** Move Google OAuth from vocab-master to hub. Hub becomes the only app that talks to Google.
- **Context:** Run parallel (hub + vocab-master both accept Google) during migration window, then remove from vocab-master.

### P0: Turnstile Bot Protection [planned]
- **What:** Cloudflare Turnstile on registration and login forms.

### P0: `@labf/auth-client` SDK [planned]
- **What:** Publish OIDC client wrapper to GitHub Packages under `@labf` scope.
- **Context:** ~100-line Express middleware + browser helpers. Handles token storage, refresh, JWKS validation.

### P0: Cloudflare Tunnel + Deployment [planned]
- **What:** Deploy hub.labf.app via Docker Compose + Cloudflare Tunnel for HTTPS.

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

### P1: Admin Panel
- **What:** User search, subscription management, audit logs, user impersonation.
- **Context:** Impersonation constraints: read-only actions, all sessions audit-logged, 30-minute timeout.

### P1: Subscription Assignment (admin-only)
- **What:** Admin assigns subscription plans via admin panel. No self-service billing yet.

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
