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
- Auth context with httpOnly cookie session (via OIDC `/auth/me`)
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

### P0: Hub OIDC Self-Client + Back-Channel Logout [done]

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

### P0: Auth-Client SDK Back-Channel Logout Support [done]

- **What:** Add `POST /auth/backchannel-logout` route to `@danwangdev/auth-client` SDK. Verifies `logout_token` JWT from oidc-provider via JWKS, finds the session for that user, and destroys the iron-session.
- **Why:** Back-channel logout requires each client app to have a logout endpoint. Building it into the SDK means vocab-master and writing-buddy get it for free.
- **Effort:** S (human: ~1 day / CC: ~15 min)
- **Depends on:** Hub OIDC Self-Client + Back-Channel Logout TODO above.
- **Context:** oidc-provider sends a signed JWT with `sub` claim. SDK endpoint verifies signature via JWKS, matches session by `sub`, and destroys it. Version bump to auth-client needed. Apps must update dependency.

### P1: User Profile Self-Service [done]

- **What:** Dashboard profile card + edit modal for self-service display name and password changes. Separate endpoints: `PATCH /api/profile` (display name) and `PATCH /api/profile/password` (password change). `has_password` OIDC claim for conditional password UI. Session overrides for stale token fix. UserMenu dropdown in header with edit profile, dashboard link, and sign out.
- **Completed:** PRs #39, #41, #42 (2026-03-29)

## Phase 1: Revenue Pipeline (planned)

> Source of truth: [Staged Revenue Pipeline design](~/.gstack/projects/DanWangDev-11plus-hub/danwa-main-design-20260408-094737.md)
> CEO review: [2026-04-08](~/.gstack/projects/DanWangDev-11plus-hub/ceo-plans/2026-04-08-staged-revenue-pipeline.md)
> Design review: [2026-04-08](~/.gstack/projects/DanWangDev-11plus-hub/danwa-main-design-review-20260408-120000.md)

### P0: Stripe Billing Integration [planned]

- **What:** Stripe Checkout Sessions for new subscriptions. Webhook handler for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Stripe Customer Portal for self-service cancel/update.
- **Effort:** S (human: ~3 days / CC: ~30 min)
- **Depends on:** Hub cloud deployment (below)
- **Schema migration:** Add `stripe_customer_id TEXT UNIQUE` and `stripe_subscription_id TEXT UNIQUE` to subscriptions. Add `stripe_processed_events` table for webhook idempotency. Extend status CHECK to include `past_due` and `incomplete`.
- **Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` added to env.ts Zod schema. Validated on startup.
- **Stripe status mapping:** `trialing` → `trial`, `active` → `active`, `canceled` → `cancelled`
- **Webhook idempotency:** Check `stripe_processed_events` by event_id, skip duplicates. Record written AFTER subscription update in same transaction.
- **UPSERT constraint:** Partial unique index extended to `ON (user_id) WHERE status IN ('active', 'trial', 'past_due')` — webhook must UPDATE existing row, not INSERT.

### P0: Hub Cloud Deployment [planned]

- **What:** Deploy hub to Fly.io or Railway with managed PostgreSQL. Migrate hub data via `pg_dump`/`pg_restore` (or fresh seed if no real users).
- **Effort:** S (human: ~1 day / CC: ~15 min)
- **Highest risk:** DNS/SSO reconfiguration. Session cookie is `Domain=.labf.app`, cloud hub must serve from same domain. Allow half-day buffer for DNS propagation + SSO smoke testing.
- **OIDC_ISSUER verification:** Startup check that `OIDC_ISSUER` matches the public domain. Must verify before going live.
- **Cloudflare Tunnel:** Stays running for NAS-hosted child apps (Writing Buddy, Vocab Master).

### P0: Writing Buddy Paywall Gate [planned]

- **What:** Two-layer gate in Writing Buddy backend: (1) check `apps` JWT claim for `writing-buddy` slug, (2) 7-day free trial with full access then paywall.
- **Effort:** S (human: ~1 day / CC: ~15 min)
- **Gate on `apps` claim, not `plan`** — uses canonical entitlement source, supports admin overrides.
- **JWT staleness:** 15-min TTL acceptable. Force refresh via `?payment=success` redirect param.
- **Trial activation:** Lazy — starts on first Writing Buddy visit, NOT at signup. `trial_start` claim set on first app access.
- **Paywall screen:** Full-page block with trial stats recap (essays completed, score improvement). Falls back to generic value prop if no learning_events data. Links to `/pricing` or direct Stripe Checkout.

### P0: Pricing Page [planned]

- **What:** Branded landing page at `/pricing` with full-width hero section. One plan, one price, one CTA. Stripe Tax enabled from day one.
- **Effort:** XS (human: ~2 hours / CC: ~10 min)
- **Layout:** Hero section with Lab F branding, product value prop (outcomes, not features), single "Subscribe" button that creates Stripe Checkout Session.
- **Subscribed users:** If JWT shows active plan, show plan status + "Manage Billing" link instead of subscribe button.
- **Copy direction:** Speak to parent anxiety ("Will my child pass the 11+ creative writing section?"), not generic AI features.

### P0: Bug Fixes (must-fix before billing goes live) [planned]

- `cancelSubscription()` must call `syncAppAccessFromPlan(sql, userId, 'free')` after setting status to cancelled
- `syncAppAccessFromPlan()` refactored to single CTE (DELETE + INSERT in one atomic statement)
- `updateSubscription()` must re-sync app access when status changes to cancelled/expired/incomplete (not just when plan changes)
- `account.ts` auto-sync must strip EXTRA apps (not just repair MISSING ones). If plan is 'free' but user_app_access has writing-buddy, remove it.
- Audit trail `actorId` must use `res.locals.user.sub` (from verified session), not forgeable `x-user-id` header
- Migration 014 must also update the partial unique index to cover `active/trial/past_due` (not just active/trial)
- Zod status enums must accept `past_due` and `incomplete`

### P0: Hub Auth Refresh Endpoint [planned]

- **What:** Add `GET /auth/refresh` route to hub-auth.ts. Re-fetches claims from OIDC provider, gets fresh id_token via refresh_token exchange, updates iron-session. Called client-side after Stripe payment redirect.
- **Why:** Hub stores id_token once in iron-session and never refreshes it. After payment, the parent's session still has `plan: 'free'` until they fully re-login. This endpoint allows a silent refresh.
- **Effort:** XS (human: ~1 hour / CC: ~10 min)
- **Context:** The ?payment=success redirect param triggers a client-side fetch to this endpoint. Also useful for any future claim staleness scenario.

### P0: Post-Payment Success Overlay [planned]

- **What:** Full-screen success overlay shown when `?payment=success` is in URL. Triggers `GET /auth/refresh`, shows checkmark animation + "Open Writing Buddy" CTA. Auto-dismisses to dashboard after 10s.
- **Effort:** XS (human: ~1 hour / CC: ~10 min)
- **Graceful degradation:** Spinner during JWT refresh. If refresh fails: "Payment confirmed! Access may take a few minutes to activate." URL param consumed on first render (prevents duplicate overlay on page refresh).
- **Accessibility:** Focus trap (Modal pattern), Escape to dismiss, auto-dismiss pauses on keyboard focus.

### P0: Subscription Card (Parent Dashboard) [planned]

- **What:** SubscriptionCard component on parent dashboard showing plan status, price, renewal date, and CTAs. 5 state variants: free (upgrade CTA), trial (days remaining + subscribe), active (plan details + manage billing), past_due (warning + update payment), cancelled (end date + resubscribe).
- **Effort:** XS (human: ~1 hour / CC: ~10 min)
- **Manage Billing** link opens Stripe Customer Portal. Status conveyed via text labels (not color alone) for accessibility.

### P0: CORS Update for Child App Origins [planned]

- **What:** Allow *.labf.app subdomains as CORS origins in app.ts. Currently only hub origin + localhost.
- **Why:** Child apps on NAS have different origins. Browser-based calls to hub APIs will fail CORS. Future-proofs for browser-based child app integrations.
- **Effort:** XS (human: ~15 min / CC: ~5 min)

### P1: Trial Expiry Banner [planned]

- **What:** Top-of-layout sticky strip with countdown. Shows on days 5-7 of trial. Escalating copy: "3 days left to keep the streak going" -> "Last day!" CTA links to `/pricing`.
- **Effort:** XS (human: ~1 hour / CC: ~10 min)
- **Design:** Amber/warning palette (bg-amber-50, border-amber-200, text-amber-800). Extends Alert component with `warning` variant. Dismiss button persists dismissal for current session.
- **Accessibility:** `role="status"` + `aria-live="polite"` (NOT `role="alert"`). Countdown uses JWT `iat` as reference (handles client clock skew).

### P1: Efficacy Tracking Endpoint [planned]

- **What:** POST `/api/learning-events` endpoint (~50 lines). Writing Buddy pushes learning events (before-score, after-score, time-spent, topic) via service-to-service token.
- **Effort:** XS (human: ~2 hours / CC: ~10 min)
- **Context:** `learning_events` table already exists. Only 12% of AI ed-tech has efficacy data.

### P1: NAS Downtime Page [planned]

- **What:** Branded static HTML maintenance page for Writing Buddy subdomain when NAS is down. Lab F branding (inline SVG logo), message: "Writing Buddy is temporarily unavailable. We're working to restore access. Your subscription is not affected." Link back to hub dashboard.
- **Effort:** XS (human: ~15 min / CC: ~5 min)
- **Hosting:** Cloudflare custom error page (recommended, works even if hub is also down). No JavaScript, no interactive elements. Semantic HTML, accessible without JS.

### P1: Subscription Audit Trail [planned]

- **What:** New AuditActions: `STRIPE_WEBHOOK_CHECKOUT`, `STRIPE_WEBHOOK_UPDATED`, `STRIPE_WEBHOOK_CANCELLED`. Logged in webhook handler.
- **Effort:** XS (human: ~20 min / CC: ~5 min)
- **Context:** Audit infrastructure already exists. Extends existing AuditActions enum.

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

### P1: Hub DESIGN.md [in progress — included in profile self-service plan]

- **What:** Extract the design system from `docs/designs/hub-idp-app.md` into a standalone `DESIGN.md`.
- **Context:** Inter typography, slate neutrals, wireframes, interaction states, responsive specs, accessibility.
- **Note:** Added to profile self-service plan scope via CEO review cherry-pick (2026-03-29).

### P1: Dynamic OIDC Client Loading [done]

- **Completed:** Already implemented in `src/oidc/pg-adapter.ts` with 60-second TTL cache. Client model queries `applications` table dynamically. Identified as already-done during CEO review (2026-04-08).

### P1: Hub Resilience Hardening

- **What:** Address 3 failure mode gaps: (1) SSO cookie blocking detection, (2) concurrent token refresh race condition, (3) OIDC signing key loss protection.
- **Context:**
  - Cookie blocking: detect SSO failure on client side, fall back to explicit login redirect (Safari ITP, privacy browsers).
  - Token refresh race: refresh token rotation with 30-second grace period.
  - Signing key protection: startup health check that verifies `OIDC_SIGNING_KEY` can sign/verify.

### P1: Resend API Key Infrastructure

- **What:** Add `RESEND_API_KEY` to env config (`src/config/env.ts`) and `docker-compose.yml`. Plumb through to a minimal `email-service.ts` that wraps the Resend SDK.
- **Why:** Prerequisite for all email features — email verification, password reset emails, welcome emails, weekly digests. Currently `password-reset.ts` has a `// TODO: Send email` comment. This is the infrastructure gate.
- **Effort:** S (human: ~30 min / CC: ~5 min)
- **Depends on:** Resend account creation (manual step, requires domain verification)

### P1: Email Notifications via Resend

- **What:** Resend integration for welcome, password reset, subscription changes.
- **Depends on:** Resend API Key Infrastructure (above)

## Phase D: Cross-app Intelligence (planned)

### P2: Learning Events API [promoted to Phase 1]

- **Moved to:** Phase 1 > P1: Efficacy Tracking Endpoint

### P2: Parent Dashboard

- **What:** Cross-app progress aggregation. Hub calls each app's stats API endpoint.
- **Context:** Per-app stat blocks with 2-3 key numbers each.

### P2: Stripe Billing Integration [promoted to Phase 1]

- **Moved to:** Phase 1 > P0: Stripe Billing Integration

### P3: Weekly Parent Email Digest

- **What:** Automated weekly email summarizing child's progress across all apps.
- **Depends on:** Phase C (Resend) + Phase D (parent dashboard)
- **Context:** Resend scheduled send or cron. Unsubscribe link required. Only send if child had activity.
