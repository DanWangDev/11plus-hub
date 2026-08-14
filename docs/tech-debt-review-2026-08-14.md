# 11plus-hub — Multi-Perspective Tech-Debt Review (2026-08-14)

## Context

A comprehensive review of this repo from four perspectives — architect, security engineer, software engineer, product — including the related apps (`vocab-master`, `writing-buddy`, `story-sleuth`, `auth-client`, `labf-infra`), and a register of everything that is or could become tech debt.

**Method:** full read of the backend (routes, services, middleware, OIDC layer, migrations, jobs, config), frontend structure, Docker/nginx/CI/deploy tooling, docs (ARCHITECTURE.md, README, TODOS.md, integration docs), and a survey of all five related repos. Everything below is verified against code with file:line references (as of 2026-08-14).

---

## Executive Summary

The hub is a well-structured, genuinely well-tested codebase — Zod at every boundary, a real audit-log framework, PKCE+state on all OIDC flows, transactional Stripe webhooks, non-root Docker images, and 80% coverage thresholds in both packages. The architecture is sound for its stage (single dev, single NAS, few dozen users).

However, the review found **3 critical security issues, 9 high-severity items, and ~30 medium/low tech-debt items**. The dominant themes:

1. **Production safety depends on env vars that default to publicly-known values** — the app boots happily in production with dev session-encryption keys, dev OIDC cookie keys, a dev hub client secret, and **ephemeral signing keys regenerated on every restart**. Nothing fails fast.
2. **The prod container seeds the database on every boot** — creating hardcoded demo users (`emma@example.com` / `student123!@#`) and hardcoded app client secrets (`vocab-dev-secret`, …) in production.
3. **The real SSO login path (OIDC interaction) has no Turnstile and no dedicated rate limit** — those protections only exist on the now-unused legacy `/api/auth/login`.
4. **Docs are badly stale** — ARCHITECTURE.md describes a `src/` tree and 9 migrations (reality: `packages/` and 19 migrations, Stripe, impersonation, BCL retry). TODOS.md marks the entire revenue pipeline "planned" though it's shipped. README's Quick Start references a `db` service that no longer exists.
5. **Operational blind spots** — no monitoring/alerting, no database backups anywhere, CD pipeline disabled, password reset is a silent no-op in production (no email infra).

---

## Part 1 — Security Perspective

### CRITICAL

**S1. Production seeds demo users + dev client secrets into the DB on every boot**
`docker-compose.prod.yml` runs `node dist/db/migrate.js up && node dist/db/seed.js && node dist/server.js` on every container start. `packages/backend/src/db/seed.ts` inserts:
- `emma` / `emma@example.com` with password `student123!@#` (line 47)
- `parent1` / `parent@example.com` with password `parent123!@#` (line 39)
- App registry rows with client secrets `vocab-dev-secret`, `writing-dev-secret`, `story-sleuth-dev-secret`, `hub-dev-client-secret` (lines 53–60)
Anyone who knows the repo can log into production as these users, and if the prod registry rows came from the seed, the OIDC client secrets are public knowledge. Seed also re-writes `url`/`redirect_uris`/`backchannel_logout_uri` for the hub app row on every boot (lines 85–96).
**Fix direction:** gate seed behind an explicit `SEED_ON_STARTUP=true` flag (default false), never seed demo users in prod, or split `seed.ts` into dev-seed and admin-bootstrap.

**S2. Production boots with publicly-known default secrets; no fail-fast**
`packages/backend/src/config/env.ts` defaults: `DB_PASSWORD='hub_dev_password'`, `SESSION_SECRET='dev-session-secret-…!!'`, `OIDC_COOKIE_KEYS='dev-oidc-cookie-key-…!!'`, `HUB_CLIENT_SECRET='hub-dev-client-secret'`, `HUB_SESSION_SECRET='hub-session-secret-…!!'` (lines 13–26). The local `.env` (key names checked only) does **not** override `HUB_SESSION_SECRET`, `OIDC_COOKIE_KEYS`, `OIDC_SIGNING_KEY`, or `HUB_CLIENT_SECRET` — so any deployment using it runs with:
- forgeable hub session cookies (iron-session key is public) → **full account takeover incl. admin**
- forgeable OIDC provider cookies (signing key public) → **SSO session hijack**
- an ephemeral OIDC signing key regenerated each restart (`server.ts:17` + `oidc/dev-keys.ts`) → all tokens/sessions invalidated every deploy, and JWKS churn
`SESSION_SECRET` itself is dead config (defined in schema, never used — only `HUB_SESSION_SECRET` is).
**Fix direction:** in env.ts, when `NODE_ENV=production`, require `HUB_SESSION_SECRET`, `OIDC_COOKIE_KEYS`, `OIDC_SIGNING_KEY`, `HUB_CLIENT_SECRET`, `DB_PASSWORD` to be set and different from defaults; throw at startup otherwise. Delete `SESSION_SECRET`.

**S3. The real SSO login path has no bot protection or dedicated rate limit**
`POST /api/auth/interaction/:uid/login` and `/google` (`packages/backend/src/routes/oidc-interactions.ts`) — the login path used by every child app — has neither Turnstile nor `loginLimiter`; only the generic `apiLimiter` (100/min/IP) applies. Turnstile + `loginLimiter` (5/15min) exist only on `/api/auth/login` (`routes/auth.ts:110`), which the frontend no longer calls (LoginPage redirects to `/api/auth/hub-login`). Brute-forcing the hub password login is only throttled at 100/min/IP.
**Fix direction:** apply `loginLimiter` to the interaction login route and verify Turnstile in `oidc-interactions.ts` (both email/password and Google), with the token passed from `InteractionPage.tsx` (widget currently only on SignupPage).

### HIGH

**S4. Audit-trail actorId is forgeable via `x-user-id` header** — `routes/applications.ts:21-25` and `routes/users.ts:20-24`. This exact bug is listed in TODOS.md's own must-fix list and is still unfixed. Admin actions can be misattributed to any user ID (insider-tampering of the audit trail, and impersonation-audit coherence breaks).
**Fix:** `actorId: res.locals.user.sub` (verified session) — impersonate.ts already does this correctly.

**S5. Rate-limit and audit-IP spoofing from the LAN** — `app.set('trust proxy', true)` unconditionally (`app.ts:43`) + `provider.proxy = true` (`oidc/provider.ts:236`) + backend port `3009:3009` published on the NAS host (`docker-compose.prod.yml`). Any device on the LAN can send `X-Forwarded-For` to rotate IPs and bypass every IP-keyed limiter. `express-rate-limit` also uses the in-memory store (resets on restart; no multi-instance support).
**Fix:** bind the port to `127.0.0.1` and/or restrict trust to known proxy hops (Cloudflare); move to a shared store when scaling.

**S6. Stripe failures are silent** — webhook handler errors return 200 by design (`routes/stripe-webhook.ts:92-94`) with only a log line, and there is no monitoring/alerting anywhere in the stack. A failed checkout/subscription update is invisible until a user complains. Combined with `mapStripeStatus` defaulting unknown statuses to `'active'` (`services/stripe-service.ts:27-29`) — a future Stripe status silently grants entitlements.
**Fix:** default unknown statuses to "no change"; add alerting on `webhook: handler failed` and `backchannel.error` log lines.

**S7. Google login accepts raw access tokens and links accounts without verifying email ownership** — `tokenType: 'access_token'` calls `verifyGoogleAccessToken` (`services/google-auth-service.ts:45`) — any leaked Google access token of a victim authenticates as them (access-token confusion; only id_tokens should be accepted). Account linking by email (`routes/auth.ts:274-297`, `routes/oidc-interactions.ts:343-373`) ignores `emailVerified` and sets `email_verified=true` on the hub account without any proof the user owns the email.
**Fix:** accept id_tokens only (reject access_token); require `email_verified===true` before auto-linking.

**S8. Broad credentialed CORS** — `app.ts:97-118` reflects any `*.labf.app` origin with `credentials: true`. Cookies are `SameSite=Lax` on `Domain=.labf.app`, so **any** labf.app subdomain (including a future one hosting user content, or a dangling/claimed subdomain) can make credentialed API calls as the logged-in user.
**Fix:** maintain an explicit allowlist of registered app origins (the registry already knows them); add `Cache-Control: no-store` on auth endpoints.

### MEDIUM

- **S10.** `GET /api/auth/refresh` mutates session state via GET (`routes/hub-auth.ts:368`); CSRF-safe under SameSite=Lax but a pattern smell → make it POST.
- **S11.** `/api/auth/reset-password` has no rate limiter (only `forgot-password` is limited, `routes/password-reset.ts:97`).
- **S12.** Password change doesn't revoke other sessions/refresh tokens (`routes/profile.ts:135-210`) — a stolen 7-day refresh token survives a password change.
- **S13.** Service tokens never expire by default (`services/app-service.ts:274-300` — `expires_at` column exists but isn't settable via API).
- **S14.** oidc-provider `long` cookie lacks explicit `secure: true` (`oidc/provider.ts:160-166`); nginx serves the SPA with no HSTS/security headers (`nginx.frontend.conf`).
- **S15.** `validateResetToken` uses non-constant-time string compare (`services/password-reset-service.ts:95`) — low practical risk (32-byte validator).
- **S16.** Client-secret verification exists in three forms: bcrypt `verifyClientSecret` (app-service), `===` SHA-256 compare (app-service:147), and timing-safe compare in `oidc/client-loader.ts:26` — the timing-safe one isn't the one in the hot path (oidc-provider does the actual compare). Consolidate.
- **S17.** `vocab-master.db-shm` (32KB) and `vocab-master.db-wal` (0 bytes) are **tracked in git** (since commit 153eaa4). No user data in the committed blobs (WAL blob is 0 bytes — verified), but SQLite sidecar files must be purged and gitignored; a non-empty WAL committed in the future would leak user data.

---

## Part 2 — Architecture Perspective

**Verified structure:** monorepo with `packages/backend` (Express 5 + oidc-provider + postgres.js, 19 SQL migrations, hourly oidc_payloads cleanup job, BCL retry queue job) and `packages/frontend` (React 19 + Vite + Tailwind 4 + react-router 7). Clean layered design: routes → services → postgres, Zod schemas at every boundary, `createApp(options)` factory with dependency injection (used well by tests), centralized error handler, structured JSON logging, request-ID middleware. The OIDC design is solid: dynamic client loading from the registry with 60s cache, SHA-256-at-rest client secrets (IdentityServer pattern) with hash-on-entry middleware, PKCE required, auto-consent for first-party clients, backchannel logout with a DB retry queue.

### HIGH (architecture debt)

**A1. Document drift is severe.** ARCHITECTURE.md describes `src/…` (code moved to `packages/` long ago), says "9 migration files" (19 exist: 001–019 incl. Stripe, BCL queue, soft-delete, last-active, sync-plan-app-access), omits Stripe/impersonation/entitlement/bcl-retry entirely, and its "Delivery Phases" table is stale. README claims "Email: Resend (welcome, reset, subscription)" and "Parent Dashboard: cross-app progress aggregation" as owned features — **neither exists**. README Quick Start says `docker compose up db -d` but there is no `db` service anymore (moved to shared labf-db). TODOS.md marks the entire Phase-1 revenue pipeline "planned" while `stripe-service.ts`, `stripe-webhook.ts`, `stripe-checkout.ts`, `PricingPage.tsx`, `TrialBanner.tsx`, `SubscriptionCard.tsx`, `PaymentSuccessOverlay.tsx` are all shipped.

**A2. Production runs `migrate` + `seed` inside the app container at startup** (see S1) — schema changes and data writes are coupled to the runtime image; two containers racing a deploy can run migrations concurrently; there's no migration-lock mechanism (`db/migrator.ts` is per-process only). The migrate-users profile in prod compose keeps one-off SQLite-import tooling in the production image.
**Fix:** separate migrate job (one-shot container or Postgres advisory lock), remove seed-on-boot, drop migrate-users from the prod image once the migration is done.

**A3. Writes on the read path: `account.ts` claims() auto-syncs `user_app_access` during every token issuance** (`oidc/account.ts:117-130`) and impersonation start (`routes/impersonate.ts:49-62`). It's atomic (single CTE) but adds DB writes to the hottest OIDC path and masks sync bugs instead of surfacing them (see A6). Consider moving repair to a background job + alert, keeping claims read-only.

**A4. Coverage thresholds are gamed.** `packages/backend/vitest.config.ts` excludes from coverage: `provider.ts`, `client-loader.ts`, `oidc-interactions.ts` (483 lines — the entire SSO login flow), `impersonate.ts` (and its test), `seed.ts`, `server.ts`, migration scripts. The 80% threshold passes precisely because the security-critical code is exempt. The frontend config has no such exclusions (good).
**Fix:** bring those files under coverage (they have tests — remove the exclusions, then fill gaps).

### MEDIUM

- **A5. Duplicated logic:** Google account-linking block is copy-pasted between `routes/auth.ts:274-322` and `routes/oidc-interactions.ts:343-393`; OIDC client mapping duplicated between `oidc/pg-adapter.ts:28-52` and `oidc/client-loader.ts:41-72` (`loadClientsFromDb` looks unused by the provider path — check and delete); dual secret storage (`client_secret_hash` bcrypt + `client_secret_sha256`, migration 011) with the bcrypt column now vestigial; `getIronSession` cookie options duplicated in ~6 places (`middleware/auth.ts`, `routes/hub-auth.ts`, `routes/impersonate.ts`, `routes/profile.ts`, `oidc/account.ts`) with `COOKIE_NAME` defined twice — a single `session.ts` helper would prevent cookie-config drift.
- **A6. Subscription reactivation bug:** `updateSubscription` (`services/subscription-service.ts:195-206`) and the Stripe `subscription.updated` webhook (`stripe-service.ts:197-211`) only sync app access on the *revocation* direction; moving `cancelled → active` (portal resume) never re-grants access. It self-heals on the next token grant via the claims() auto-sync, but the entitlement API and fresh logins are wrong in between.
- **A7. Dead code:** `audit-service.getActorHistory` appears unused (no route calls it); `SESSION_SECRET` env var is dead; `verifyClientSecret` (bcrypt) likely dead after the SHA-256 switch.
- **A8. DI inconsistency:** most routes take `options.sql ?? db`, but `applications.ts` and the auth middleware hardcode the `db` singleton import (`middleware/auth.ts:4`, `routes/applications.ts:3`) — makes those modules harder to test in isolation.
- **A9. `LOG_LEVEL` env is parsed but never wired into `lib/logger.ts`** (no level filtering); request IDs (`middleware/request-id.ts`) are set but never included in log entries; the error handler doesn't log unknown 500s (`middleware/error-handler.ts:21-37`), so oidc-provider/middleware errors can fail silently. `oidc/pg-adapter.ts` logs at info level per payload upsert/consume — noisy at any real traffic level.
- **A10. Module-level caches in `hub-auth.ts`** (discovery 5 min, JWKS 10 min) are per-process — fine on one NAS box, stale in any multi-instance future; note for the cloud move.
- **A11. Legacy compat shims still live:** `/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/me`, `/auth/backchannel-logout` redirects in `routes/hub-auth.ts:490-509` and the old `/auth/callback` redirect_uri in `seed.ts:69` both say "remove after 2 weeks" — still present; `POST /api/auth/login` + `/api/auth/google` return a literal `'placeholder-jwt-token'` (`routes/auth.ts:218`, `:355`) — dead API surface that will confuse the next integrator.
- **A12. `buildUserClaims` (impersonate) duplicates the claims assembly of `account.ts`** — two places must agree on what a user's claims look like.
- **A13. Impersonation audit end-log `duration` field is meaningless** — `routes/impersonate.ts:208` computes `Date.now() - start` where `start` is the request-entry time (~0ms), not the impersonation span; `startedAt` exists in the session but isn't included.
- **A14. `listUsers`/`countUsers`** (`services/user-service.ts:240-317`) duplicate 4 filter branches each where the dynamic-tag pattern used by `listSubscriptions` would do — consistency debt only.
- **A15. Prod image ships devDependencies** (`Dockerfile`: `npm ci -w packages/backend` without `--omit=dev`); Dockerfile/CI use Node 24 while docs say Node 20 (minor).

---

## Part 3 — Product & Operations Perspective

### Related-apps integration matrix (verified)

| App | Auth state | SDK version | Data | labf-net | Compose hygiene |
|---|---|---|---|---|---|
| **vocab-master** | **Partial migration** — `hubAuth.ts` alongside legacy `auth.ts`/`authService.ts`/`routes/auth.ts`; cleanup migration 027 exists | backend `^0.3.1`, frontend `^0.1.0` (drift) | SQLite (own) | yes | OIDC env in compose, secret required |
| **writing-buddy** | **Partial** — legacy `middleware/auth.ts` + auth tests remain; uses SDK JwtVerifier pattern | `^0.3.1` | **still SQLite** (`DATABASE_PATH=/app/data/…`) while others moved to labf-db | yes | no healthcheck, no pull_policy |
| **story-sleuth** | **Cleanest** — SDK `^0.3.1`, no legacy user-auth code (`auth/` is service-to-service for its LLM API) | `^0.3.1` | shared labf-db | yes | healthcheck, pull_policy, IMAGE_TAG — best-in-suite |
| **auth-client** | Standalone repo, `@danwangdev/auth-client` v0.3.1, server/react/types/test-helpers entry points | — | — | — | published & consumed by all 3 apps |

### HIGH (product/ops debt)

**P1. Password reset is non-functional in production.** `forgot-password` never sends an email — the token is only returned in dev/test (`routes/password-reset.ts:54-65`). Resend was planned (TODOS Phase C) but never integrated. Consequences: locked-out users cannot recover; Google-only users hit the dead-end message "Set a password via forgot-password first" (`routes/profile.ts:167-170`) — a promise the product can't keep.

**P2. No monitoring, alerting, or health observability anywhere in the suite.** No uptime checks, no log aggregation, no alert on: Stripe handler failures (silent by design, S6), BCL failures, migration failures, seed failures, DB down. The hub has `/health` and `/ready` (good) but nothing watches them.

**P3. No database backup strategy.** `labf-infra/README.md` literally says the infra is "Owned by nobody." The shared `labf-db` volume (`labf-pgdata`) holds all identity + subscription data (hub) and story-sleuth data. No pg_dump cron, no off-site copy. One NAS disk failure = the whole business. `labf-db` also exposes port 5433 on the LAN with a default password `hub_dev_password` fallback, and pgadmin runs with default password `admin` on port 5040.

**P4. CD pipeline disabled.** `.github/workflows/deploy.yml.disabled` — the NAS runner was never set up, so every deploy is manual `deploy.sh` (down → up = visible downtime each deploy, no health check after, no rollback).

**P5. Entitlement-at-login contradicts the paywall product plan.** `checkUserEntitlement` denies login to the app entirely for non-entitled users (`routes/oidc-interactions.ts:159-181`). But the TODOS trial plan says "trial activation is lazy — starts on first app visit, not at signup" and the paywall plan is a gate *inside* Writing Buddy. A brand-new free user cannot reach the in-app paywall at all — they get a 403 at login. The two flows need a product decision (deny-at-login vs allow-login-and-gate-in-app).

**P6. Feature-complete but untracked roadmap.** TODOS.md is the de-facto backlog, but it's stale in both directions (revenue pipeline "planned" though shipped; bug-fix list mostly shipped but several items demonstrably unfixed, e.g. the x-user-id actorId, S4). No CHANGELOG, no VERSION in the hub repo (writing-buddy and gstack repos have both).

### MEDIUM

- **P7. Email infra entirely absent** — no email verification on signup (accounts can be registered with someone else's email; only affects Google-linking, S7), no welcome/reset/digest emails. Resend integration is the gate for several planned features.
- **P8. Learning-events table exists but no ingest API** (`learning_events` migrated, `POST /api/learning-events` still "planned" in TODOS) — the parent-dashboard/efficacy data pipeline has no producer.
- **P9. Compose/docker conventions drift across the 4 repos** — healthchecks and `pull_policy` only in story-sleuth; `bootstrap.sh` ownership comments contradict each other; deploy.sh env-file confusion: checks `.env.production` but the service `env_file: .env` is what actually reaches the container.
- **P10. Downtime per deploy** (down → up in deploy.sh and the disabled workflow) — acceptable pre-revenue, debt the day paying users exist.
- **P11. No smoke-test or canary after deploy** despite the gstack `canary`/`qa` skills being available and designed for this.
- **P12. UI polish gaps:** Turnstile only on the signup page — the interaction page (the actual password entry point for child apps) has none; trial banner exists but entitlement-at-login may prevent trial users from ever seeing an app; admin UI depends on the audit trail that S4 makes unreliable.

---

## Consolidated Tech-Debt Register (severity-ordered)

| # | Severity | Area | Item | Where |
|---|---|---|---|---|
| S1 | CRITICAL | sec | Prod seeds demo users + dev client secrets on every boot | seed.ts + docker-compose.prod.yml |
| S2 | CRITICAL | sec | Known default secrets boot in prod; ephemeral signing key per restart; no fail-fast | env.ts, server.ts, dev-keys.ts |
| S3 | CRITICAL | sec | No Turnstile/rate-limit on the real SSO login path | oidc-interactions.ts |
| S4 | HIGH | sec | Forgeable x-user-id audit actorId (their own TODO, unfixed) | applications.ts:21, users.ts:20 |
| S5 | HIGH | sec | trust-proxy + host-published port → LAN IP spoofing of all rate limits | app.ts:43, provider.ts:236, compose |
| S6 | HIGH | sec/ops | Silent Stripe failures; unknown Stripe status → 'active' | stripe-webhook.ts:92, stripe-service.ts:27 |
| S7 | HIGH | sec | Google access-token confusion + unverified-email account linking | google-auth-service.ts:45, auth.ts:274, oidc-interactions.ts:343 |
| S8 | HIGH | sec | Credentialed CORS for any *.labf.app | app.ts:97 |
| A1 | HIGH | arch | Docs severely stale (ARCHITECTURE/README/TODOS vs code) | docs + packages/ |
| A2 | HIGH | arch | migrate+seed coupled to app boot; no migration lock | migrator.ts, compose command |
| A3 | HIGH | arch | Writes on token-issuance read path (claims auto-sync) | account.ts:117 |
| A4 | HIGH | arch | Coverage thresholds exclude security-critical files | vitest.config.ts |
| P1 | HIGH | product | Password reset silently broken in prod (no email) | password-reset.ts:54 |
| P2 | HIGH | ops | No monitoring/alerting anywhere | — |
| P3 | HIGH | ops | No DB backups; labf-db default password + pgadmin default | labf-infra |
| P4 | HIGH | ops | CD disabled; manual down→up deploys, no post-deploy check | deploy.yml.disabled |
| P5 | HIGH | product | Entitlement-at-login blocks paywall/trial flow | oidc-interactions.ts:159 |
| P6 | HIGH | product | Roadmap untracked; no CHANGELOG/VERSION in hub | TODOS.md |
| A5 | MED | arch | Duplicated Google-link, client-mapping, session-cookie code | auth.ts / oidc-interactions.ts / pg-adapter / client-loader |
| A6 | MED | arch | Subscription reactivation never re-grants app access | subscription-service.ts:195, stripe-service.ts:197 |
| A7 | MED | arch | Dead code: getActorHistory, SESSION_SECRET, verifyClientSecret(bcrypt) | audit-service, env.ts, app-service |
| A8 | MED | arch | DI inconsistency (global db import in auth middleware + applications route) | middleware/auth.ts:4 |
| A9 | MED | arch | LOG_LEVEL unwired; request IDs unused in logs; silent 500s; noisy pg-adapter | logger.ts, error-handler.ts |
| A10 | MED | arch | Per-process OIDC discovery/JWKS caches (cloud-move debt) | hub-auth.ts |
| A11 | MED | arch | Legacy placeholder JWT + "remove after 2 weeks" shims still live | auth.ts:218, hub-auth.ts:490 |
| A12 | MED | arch | Claims assembly duplicated (account.ts vs impersonate buildUserClaims) | impersonate.ts:26 |
| A13 | MED | arch | Impersonation end-log duration meaningless | impersonate.ts:208 |
| A14 | MED | arch | listUsers/countUsers branch duplication | user-service.ts:240 |
| A15 | MED | arch | Prod image ships dev deps; Node 24 vs docs Node 20 | Dockerfile |
| S10–S17 | MED/LOW | sec | refresh-via-GET, no limiter on reset-password, no session revocation on password change, non-expiring service tokens, no Secure on oidc long cookie, no HSTS, non-timing-safe validator compare, three secret-verify impls, SQLite sidecars in git | see Part 1 |
| P7–P12 | MED | product | No email infra, no learning-events ingest, compose drift across repos, downtime deploys, no post-deploy smoke test, Turnstile only on signup | see Part 3 |

## What's Healthy (keep doing)

- **Code quality bar is genuinely high:** Zod at every boundary, layered routes→services, centralized errors, `ApiResponse<T>` consistency, immutability respected, strict TS, ESLint + Prettier gates, 80% thresholds in CI with frontend fully covered.
- **OIDC fundamentals correct:** PKCE S256 required, state validated, code TTL 60s, access 15min/refresh 7d, SHA-256-at-rest secrets with hash-on-entry middleware, dynamic client loading with cache invalidation on rotate, BCL retry queue with backoff, hourly oidc_payloads cleanup, impersonation is read-only + audit-logged + 30-min cookie, write-blocking during impersonation.
- **Stripe handling is mostly right:** raw-body signature verification, idempotency table, transactional updates, single-CTE access sync, portal + checkout flows.
- **Testing culture:** backend ~19 test files incl. route-level supertest coverage, frontend ~25 test files; tests exist for the trickiest parts (BCL retry, pg-adapter, entitlement, impersonation).
- **Deployment fundamentals:** non-root image user, dumb-init, GHCR multi-stage builds, idempotent bootstrap, health/readiness endpoints, structured JSON logs.

## Recommended Remediation Roadmap

**P0 (do this week — security)**
1. Prod fail-fast: require non-default secrets in production env (S2); delete dead `SESSION_SECRET`.
2. Stop seed-on-boot in prod; make seed dev-only/explicit (S1); rotate any prod app client secrets that came from the seed; delete/disable demo users in prod DB.
3. Add `loginLimiter` + Turnstile to interaction login + Google endpoints (S3).
4. Fix actorId to `res.locals.user.sub` in applications.ts + users.ts (S4).

**P1 (this month — correctness + observability)**
5. Restrict `trust proxy` and stop publishing backend port on the host (S5).
6. Stripe: unknown status → no-change; alert on webhook failures (S6). Drop access-token acceptance + verify email before linking (S7). CORS allowlist from registry (S8).
7. Re-grant on subscription reactivation (A6); remove coverage exclusions and close gaps (A4).
8. Stand up minimum monitoring (Uptime-Kuma or similar on the NAS: /health checks, log alerting) + a nightly `pg_dump` cron for labf-db with off-NAS copy (P2/P3).
9. One docs-sync pass: ARCHITECTURE.md, README, TODOS.md; delete legacy placeholder-token endpoints and 2-week-old shims (A1/A11).

**P2 (next quarter — product)**
10. Resend integration → real password reset emails (P1/P7); decide paywall vs deny-at-login (P5).
11. Re-enable CD (NAS runner) with post-deploy smoke test (P4/P11); align compose conventions across repos (P9).
12. Consolidate duplicated auth/link/session code (A5/A12); wire LOG_LEVEL + request-ID logging (A9); clean dead code (A7).

**P3 (when scaling / before cloud)**
13. Shared rate-limit store + advisory migration lock + multi-instance cache strategy (A2/A10/S5); key rotation story for OIDC_SIGNING_KEY; remove dual secret storage + migrate-users tooling from prod image (A15).

---

## Verification notes

- All file references are from a direct read of the working tree at 2026-08-14; line numbers may drift as the repo evolves.
- The local `.env` was checked for **key names only** — no secret values were read or included in this report.
- One item could not be fully confirmed from this machine: whether the NAS `.env` sets `HUB_SESSION_SECRET`/`OIDC_SIGNING_KEY` (S2 severity depends on it). Verify with `docker exec hub-backend printenv | grep -E "HUB_SESSION|OIDC_SIGNING"` on the NAS as part of P0.
