# Writing Buddy OIDC Integration Feedback

Issues discovered while integrating writing-buddy as an OIDC client app against the hub identity provider.

## Issues Found & Fixed (now on main)

### 1. PG Adapter Double-Serialization (CRITICAL)

**File:** `src/oidc/pg-adapter.ts`

The original code used `${JSON.stringify(payload)}` to insert into a `jsonb` column. PostgreSQL's `jsonb` expects a JSON object, but `JSON.stringify()` produces a string — causing double-serialization. When `oidc-provider` later read the payload back, it got a string instead of an object, causing `Interaction.find(id)` to return `undefined` even though the row existed.

**Fix:** Changed to `${sql.json(JSON.parse(JSON.stringify(payload)))}` — deep-clones the payload and uses the postgres driver's `sql.json()` helper for proper jsonb insertion.

### 2. Helmet CSP Blocking OIDC Redirects (HIGH)

**File:** `src/app.ts`

The default `helmet()` CSP sets `form-action: 'self'`, which blocked the OIDC authorization redirect from client apps on different origins (e.g., `localhost:5179` -> `localhost:3009`). The browser silently aborted the redirect with `ERR_ABORTED`.

**Fix:** Configured helmet to allow `form-action` for `'self'`, `http://localhost:*`, and `https://*.labf.app`.

### 3. ID Token Missing Claims (HIGH)

**File:** `src/oidc/provider.ts`

With the default `conformIdTokenClaims: true`, the id_token only contained basic claims (`sub`, `iss`, `aud`, etc.). Profile, email, and hub claims were only available via the userinfo endpoint. Client apps that verify the id_token locally (without calling userinfo) had no user data.

**Fix:** Set `conformIdTokenClaims: false` so all requested claims are included directly in the id_token.

## Recommendations for Future Client App Integrations

### Client Registration

Currently, OIDC clients must be manually inserted into the `oidc_payloads` table. Consider adding:
- An admin UI for client registration
- A CLI command or migration script for registering known clients
- Documentation for required client configuration fields

### Token Strategy Documentation

The hub issues **opaque** access tokens and **JWT** id_tokens. This is non-obvious and caused confusion during integration. Client apps should use the `id_token` as the Bearer token for backend API calls, not the `access_token`. Document this clearly.

### PKCE-Only Public Clients

The hub correctly enforces PKCE with S256. Client registration should document that `token_endpoint_auth_method: "none"` is required for public SPA clients, and that `grant_types` should only include `authorization_code` (not `refresh_token` — the hub doesn't support refresh for public clients via grant_types, only via the refresh token flow).

### Error Diagnostics

The `renderError` callback now includes verbose logging (`fullOut`, `originalError`, `stack`). Consider keeping this in production with appropriate log levels — OIDC errors are notoriously opaque without detailed server-side logs.
