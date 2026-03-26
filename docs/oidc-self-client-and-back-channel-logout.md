# Hub OIDC Self-Client & Back-Channel Logout

This document describes the planned changes to make the hub use its own OIDC
provider for authentication ("eat its own dog food") and enable back-channel
logout for instant session propagation across all client apps.

**Status:** Planned
**Blocks:** Phase B app migrations (vocab-master, writing-buddy)
**Affects:** Hub backend, hub frontend, `@danwangdev/auth-client` SDK, all client apps

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Root Cause Analysis](#root-cause-analysis)
3. [Architecture Overview](#architecture-overview)
4. [Hub-Side Changes](#hub-side-changes)
5. [Auth-Client SDK Changes](#auth-client-sdk-changes)
6. [Client App Migration Guide](#client-app-migration-guide)
7. [Database Migrations](#database-migrations)
8. [Configuration Reference](#configuration-reference)
9. [Testing Checklist](#testing-checklist)
10. [Rollout Plan](#rollout-plan)

---

## Problem Statement

Three bugs stem from the same root cause:

1. **Cross-tab login not persisted:** User logs in on one browser tab, opens
   another tab — the login page appears again instead of the dashboard.
2. **Cross-app SSO broken:** User logs in at the hub, navigates to vocab-master
   or writing-buddy — the app doesn't recognize the session and redirects to login.
3. **User-switch not propagated:** User A logs out, User B logs in at the hub.
   Client apps still show User A's data until the access token expires (up to 15 min).

---

## Root Cause Analysis

The hub runs **two completely disconnected auth systems**:

```
┌─────────────────────────────────────────────────────────┐
│                    CURRENT STATE                         │
│                                                          │
│  Path 1: Direct Auth (hub frontend uses this)           │
│  ─────────────────────────────────────                  │
│  POST /api/auth/login                                   │
│    → validates credentials                              │
│    → returns { token: "placeholder-jwt-token" }         │
│    → frontend stores in localStorage                    │
│    → NO server session created                          │
│    → NO OIDC session created                            │
│    → cookies: NONE                                      │
│                                                          │
│  Path 2: OIDC Provider (client apps use this)           │
│  ─────────────────────────────────────────              │
│  /oidc/auth → /auth/interaction/:uid/login              │
│    → validates credentials                              │
│    → creates OIDC session (httpOnly cookie)             │
│    → issues authorization code                          │
│    → client exchanges code for tokens                   │
│    → client stores tokens in iron-session               │
│                                                          │
│  These two paths NEVER talk to each other.              │
└─────────────────────────────────────────────────────────┘
```

**Why cross-tab fails:** localStorage is tab-independent, but the hub frontend
reads it on mount. The real issue is that `"placeholder-jwt-token"` is not a
real JWT — the hub has no server session at all. Any validation fails.

**Why cross-app SSO fails:** Client apps redirect to the hub's OIDC provider,
but the provider has no session (the user logged in via the direct path).
The user gets prompted to log in again.

**Why user-switch fails:** Even when OIDC works, client app sessions
(iron-session cookies) are independent of the hub's OIDC session. Logging out
at the hub doesn't invalidate client sessions.

---

## Architecture Overview

### Target State

```
┌─────────────────────────────────────────────────────────────┐
│                     TARGET STATE                             │
│                                                              │
│  Hub Frontend (React SPA)                                   │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ /login   │───▶│ /oidc/auth   │───▶│ /auth/       │      │
│  │ (button) │    │ (OIDC        │    │ callback     │      │
│  └──────────┘    │  redirect)   │    │ (code        │      │
│                  └──────┬───────┘    │  exchange)   │      │
│                         │            └──────┬───────┘      │
│                         ▼                   ▼              │
│                  ┌──────────────┐    ┌──────────────┐      │
│                  │ Interaction  │    │ iron-session  │      │
│                  │ Login Page   │    │ cookie set    │      │
│                  │ (+ Google)   │    │ (httpOnly)    │      │
│                  └──────────────┘    └──────────────┘      │
│                                                              │
│  Client Apps (vocab-master, writing-buddy)                  │
│  Same flow — identical OIDC redirect dance.                 │
│  Same auth-client SDK. Same iron-session.                   │
│                                                              │
│  Back-Channel Logout                                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Hub: user    │───▶│ oidc-provider│───▶│ POST to each │  │
│  │ logs out     │    │ destroys     │    │ client's     │  │
│  │              │    │ session      │    │ /auth/bcl    │  │
│  └──────────────┘    └──────────────┘    └──────┬───────┘  │
│                                                  ▼          │
│                                           ┌──────────────┐  │
│                                           │ Client       │  │
│                                           │ iron-session  │  │
│                                           │ destroyed    │  │
│                                           └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Key principle:** The hub becomes a standard OIDC client of its own provider —
identical to vocab-master and writing-buddy. One pattern for all apps.

---

## Hub-Side Changes

### 1. Register hub as an OIDC client

The hub gets a row in the `applications` table:

| Field | Value |
|-------|-------|
| `name` | `11plus Hub` |
| `slug` | `hub` |
| `client_id` | `hub` |
| `client_secret_sha256` | SHA-256 of generated secret |
| `redirect_uris` | `["https://hub.labf.app/auth/callback"]` |
| `url` | `https://hub.labf.app` |
| `backchannel_logout_uri` | `https://hub.labf.app/auth/backchannel-logout` |
| `status` | `active` |

This is created via a seed migration, not manually.

### 2. Enable back-channel logout

In `src/oidc/provider.ts`, add to the features configuration:

```typescript
features: {
  devInteractions: { enabled: false },
  resourceIndicators: { enabled: false },
  rpInitiatedLogout: { enabled: true },
  backchannelLogout: { enabled: true },  // NEW
}
```

Add event listeners for observability:

```typescript
provider.on('backchannel.success', (...args) => {
  logger.info('backchannel logout success', { ... })
})

provider.on('backchannel.error', (...args) => {
  logger.error('backchannel logout failed', { ... })
})
```

### 3. Add `backchannel_logout_uri` to client loader

In `src/oidc/client-loader.ts`, include the new field when building `ClientMetadata`:

```typescript
return {
  client_id: app.client_id,
  // ... existing fields ...
  backchannel_logout_uri: app.backchannel_logout_uri ?? undefined,
}
```

### 4. Add Google OAuth to the OIDC interaction login page

The OIDC interaction login page (`/auth/interaction/:uid/login`) gets a
Google Sign-In button. This means **all apps** that redirect to the hub for
login automatically get Google OAuth support — no per-app implementation needed.

Backend: The existing `POST /api/auth/google` endpoint is reused. The
interaction login page sends the Google token to a new endpoint:
`POST /api/auth/interaction/:uid/google` which verifies the token and
completes the OIDC interaction.

### 5. Rewrite hub frontend AuthContext

Replace localStorage-based auth with httpOnly cookie-based auth:

**Before:**
```typescript
// auth-context.tsx
const [user, setUser] = useState(() => {
  const stored = localStorage.getItem('hub_user')
  return stored ? JSON.parse(stored) : null
})
```

**After:**
```typescript
// auth-context.tsx — uses fetch to /auth/me (cookie-backed)
const [user, setUser] = useState(null)

useEffect(() => {
  fetch('/auth/me', { credentials: 'include' })
    .then(res => res.ok ? res.json() : null)
    .then(data => setUser(data?.data ?? null))
}, [])
```

### 6. Deprecate direct login endpoint

`POST /api/auth/login` is deprecated. The hub frontend redirects to
`/auth/login` (the auth-client SDK route) which initiates the OIDC flow.

The registration endpoint (`POST /api/auth/register`) stays — registration
is not an OIDC concern.

---

## Auth-Client SDK Changes

### New endpoint: `POST /auth/backchannel-logout`

The SDK adds a new route that receives back-channel logout notifications
from the hub's OIDC provider.

**Flow:**

```
1. Hub OIDC provider sends POST to {app}/auth/backchannel-logout
   Content-Type: application/x-www-form-urlencoded
   Body: logout_token=<JWT>

2. SDK verifies the logout_token JWT:
   - Fetches JWKS from hub (cached)
   - Validates signature, issuer, audience
   - Extracts `sub` claim (the user being logged out)

3. SDK destroys the iron-session for that user
   - Iterates session store or marks session as invalidated

4. Returns 200 OK (or 400 if token invalid)
```

**New config field:**

```typescript
interface AuthServerConfig {
  // ... existing fields ...

  /** Enable back-channel logout endpoint.
   *  When true, adds POST {basePath}/backchannel-logout route.
   *  Requires JWKS verification — uses `issuer` for key fetch.
   *  Default: false */
  readonly backchannelLogout?: boolean
}
```

### Updated `OidcMetadata` type

```typescript
interface OidcMetadata {
  // ... existing fields ...
  readonly backchannel_logout_supported?: boolean
  readonly backchannel_logout_session_supported?: boolean
}
```

### Version bump

Auth-client SDK bumps to **v0.3.0** (minor version — new feature, backwards-compatible).

---

## Client App Migration Guide

### For vocab-master and writing-buddy

#### Step 1: Update `@danwangdev/auth-client` to v0.3.0

```bash
npm install @danwangdev/auth-client@0.3.0
```

#### Step 2: Enable back-channel logout in config

```typescript
// server.ts or wherever you configure auth
import { createAuthRoutes } from '@danwangdev/auth-client/server'

const authRoutes = createAuthRoutes({
  issuer: process.env.HUB_ISSUER_URL,
  internalIssuer: process.env.HUB_INTERNAL_URL,
  clientId: process.env.HUB_CLIENT_ID,
  clientSecret: process.env.HUB_CLIENT_SECRET,
  redirectUri: process.env.HUB_REDIRECT_URI,
  postLogoutRedirectUri: process.env.POST_LOGOUT_REDIRECT_URI,
  sessionSecret: process.env.SESSION_SECRET,
  backchannelLogout: true,  // NEW — enables POST /auth/backchannel-logout
})
```

#### Step 3: Register `backchannel_logout_uri` in the hub

Via the hub admin panel or API, update your app's registration to include:

```
backchannel_logout_uri: https://<your-app-domain>/auth/backchannel-logout
```

For example:
- vocab-master: `https://vocab.labf.app/auth/backchannel-logout`
- writing-buddy: `https://writing.labf.app/auth/backchannel-logout`

#### Step 4: Verify in Docker network

If running in Docker, ensure the hub can reach the client app's
`backchannel_logout_uri`. In docker-compose, apps should be on the same
network. The hub sends the POST server-to-server, so use internal URLs:

```yaml
# In the hub's applications table, for Docker deployments:
backchannel_logout_uri: http://vocab-master:3000/auth/backchannel-logout
```

#### Step 5: Test the flow

1. Log in to the hub
2. Log in to your client app (should SSO — no second login)
3. Open the client app in a second tab (should still be logged in)
4. Log out at the hub
5. Refresh the client app tab — should be logged out
6. Log in as a different user at the hub
7. Refresh the client app tab — should show the new user

### What doesn't change

- **OIDC redirect flow** — unchanged. Same endpoints, same PKCE, same scopes.
- **Token format** — unchanged. Same JWT claims, same JWKS verification.
- **iron-session cookies** — unchanged format. The SDK just adds a way to
  destroy them on back-channel logout.
- **`requireAuth` / `optionalAuth` middleware** — unchanged.
- **React `AuthProvider`** — unchanged. Still fetches `/auth/me`.
- **Token refresh** — unchanged. Refresh tokens still work the same way.

### What's new (but backwards-compatible)

| Feature | Before | After |
|---------|--------|-------|
| Back-channel logout | Not supported | Opt-in via `backchannelLogout: true` |
| Google OAuth at login | Per-app implementation | Built into hub OIDC login page |
| Cross-tab login | Broken (hub only) | Works everywhere (OIDC session cookie) |
| User-switch propagation | 15-min stale window | Near-instant via BCL |

### Breaking changes

**None.** All changes are additive and backwards-compatible. Apps that don't
update to v0.3.0 continue to work — they just won't get instant logout
propagation (they fall back to token expiry).

---

## Database Migrations

### Migration: Add `backchannel_logout_uri` to applications

```sql
-- up
ALTER TABLE applications
  ADD COLUMN backchannel_logout_uri TEXT;

COMMENT ON COLUMN applications.backchannel_logout_uri IS
  'URL where the hub sends back-channel logout notifications (POST with logout_token JWT)';

-- down
ALTER TABLE applications DROP COLUMN IF EXISTS backchannel_logout_uri;
```

### Migration: Seed hub as OIDC client

```sql
-- up
-- Hub registers itself as an OIDC client
-- client_secret_sha256 and redirect_uris are set via env vars at startup
-- This insert uses ON CONFLICT to be idempotent
INSERT INTO applications (name, slug, url, client_id, client_secret_hash, redirect_uris, status)
VALUES (
  '11plus Hub',
  'hub',
  '${HUB_URL}',
  'hub',
  'managed-at-runtime',
  ARRAY['${HUB_URL}/auth/callback'],
  'active'
)
ON CONFLICT (slug) DO NOTHING;

-- down
DELETE FROM applications WHERE slug = 'hub';
```

Note: The actual client secret SHA-256 is populated at startup from environment
variables, not hardcoded in the migration.

---

## Configuration Reference

### New environment variables (hub)

| Variable | Required | Description |
|----------|----------|-------------|
| `HUB_CLIENT_ID` | Yes | OIDC client ID for the hub itself (default: `hub`) |
| `HUB_CLIENT_SECRET` | Yes | OIDC client secret for the hub (auto-generated on first run) |
| `HUB_SESSION_SECRET` | Yes | Secret for encrypting the hub's iron-session cookie (min 32 chars) |

### New environment variables (client apps)

None — existing `HUB_CLIENT_ID`, `HUB_CLIENT_SECRET`, etc. are unchanged.

### New auth-client config fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `backchannelLogout` | `boolean` | `false` | Enable the back-channel logout endpoint |

---

## Testing Checklist

### Hub-side tests

- [ ] Hub registered as OIDC client in applications table
- [ ] Hub frontend login redirects to OIDC flow (not direct auth)
- [ ] Hub frontend AuthContext loads user from `/auth/me` cookie
- [ ] Hub frontend AuthContext handles 401 (not logged in) → redirect to login
- [ ] Cross-tab: login in tab 1, open tab 2 → user is logged in
- [ ] OIDC interaction login page shows Google OAuth button
- [ ] Google OAuth in OIDC interaction creates OIDC session correctly
- [ ] Back-channel logout feature enabled in provider config
- [ ] Back-channel logout sends POST to registered client URIs on session destroy
- [ ] Back-channel logout failure is logged but doesn't block hub logout
- [ ] Hub app seed is idempotent (ON CONFLICT DO NOTHING)

### Auth-client SDK tests

- [ ] `POST /auth/backchannel-logout` verifies logout_token JWT signature
- [ ] `POST /auth/backchannel-logout` rejects invalid/expired tokens
- [ ] `POST /auth/backchannel-logout` destroys iron-session for the `sub` claim
- [ ] `POST /auth/backchannel-logout` returns 200 on success
- [ ] `POST /auth/backchannel-logout` returns 400 on invalid token
- [ ] Endpoint not mounted when `backchannelLogout: false` (default)
- [ ] Backwards-compatible: existing apps work without config changes

### End-to-end tests

- [ ] Hub login → vocab-master SSO (no second login)
- [ ] Hub login → writing-buddy SSO (no second login)
- [ ] Hub logout → vocab-master session destroyed (refresh shows login)
- [ ] Hub logout → writing-buddy session destroyed (refresh shows login)
- [ ] User A login → client app shows A → hub logout → User B login → client app refresh shows B

---

## Rollout Plan

### Phase 1: Hub-side changes (no client impact)

1. DB migration: add `backchannel_logout_uri` column
2. Enable `backchannelLogout` in oidc-provider config
3. Register hub as OIDC client (seed migration)
4. Add Google OAuth to OIDC interaction login page
5. Rewrite hub frontend AuthContext (localStorage → cookie)
6. Deploy hub

**Client apps are unaffected.** They continue to work as before.

### Phase 2: SDK update

1. Implement `POST /auth/backchannel-logout` in auth-client SDK
2. Bump SDK to v0.3.0
3. Publish to GitHub Packages

### Phase 3: Client app updates

1. Update vocab-master to auth-client v0.3.0
2. Enable `backchannelLogout: true` in config
3. Register `backchannel_logout_uri` in hub admin
4. Deploy vocab-master
5. Repeat for writing-buddy

### Phase 4: Verification

1. Run full E2E test suite (testing checklist above)
2. Verify cross-tab login works for hub
3. Verify SSO works across all apps
4. Verify logout propagation is near-instant
5. Monitor `backchannel.error` events in hub logs

---

## Failure Modes & Resilience

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Client app unreachable during BCL | Hub logout succeeds. Client session survives until token expiry (15 min). | Hub logs the failure. Client falls back to token expiry. |
| Invalid `logout_token` signature | Client rejects the token. Session preserved. | SDK returns 400. Hub logs the error. |
| Client app not updated to v0.3.0 | No BCL endpoint exists. oidc-provider gets a network error. | Hub logout still succeeds. Client uses existing token expiry. |
| Hub OIDC provider down | Client apps can't start new login flows. Existing sessions still valid. | Health check monitors. Existing tokens work until expiry. |
| `backchannel_logout_uri` misconfigured | BCL goes to wrong URL. 404 or timeout. | Hub logs the error. Falls back to token expiry. |

**Design principle:** Back-channel logout is best-effort. It improves UX
(instant logout propagation) but the system degrades gracefully without it.
No app ever breaks because of a BCL failure.
