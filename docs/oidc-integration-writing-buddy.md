# OIDC SSO Integration Guide — Writing Buddy

This document describes the changes made to the 11plus-hub's OIDC provider
and what (if anything) needs to change in writing-buddy to stay compatible.

## TL;DR

**Almost nothing changes in writing-buddy.** The hub's OIDC changes are
backwards-compatible with the current `@danwangdev/auth-client` integration.
The main action item is a one-time secret rotation and a minor type update.

Writing-buddy uses the `JwtVerifier` pattern (Bearer token verification) rather
than session-based OIDC routes. This pattern is unaffected by most of the
hub's changes, but there are a few considerations noted below.

---

## What Changed in the Hub

### 1. Client Secret Storage: bcrypt → SHA-256

**What:** The hub now stores client secrets as SHA-256 hashes instead of bcrypt.

**Why:** The previous implementation was broken — the hub passed the bcrypt hash
directly to oidc-provider as the `client_secret`, but oidc-provider does string
equality comparison. This meant `client_secret_basic` authentication always
failed (plaintext !== bcrypt hash). Additionally, bcrypt is overkill for
machine-generated secrets (32 bytes of random hex). The industry standard
(used by Duende IdentityServer, and what Keycloak is adopting) is SHA-256 —
fast, secure, and no CPU overhead at scale.

**How it works now (IdentityServer pattern):**

```
1. App sends:  client_secret=<plaintext>  (in POST body, standard OAuth2)
2. Hub middleware intercepts: computes SHA-256(plaintext)
3. oidc-provider compares: SHA-256(incoming) === SHA-256(stored)  ✓
```

The middleware (`secret-auth-middleware.ts`) sits in front of `/oidc/token` and
transparently hashes the incoming secret. From the client app's perspective,
nothing changes — you still send the plaintext secret.

**Action required:** The existing applications in the database only have bcrypt
hashes (the `client_secret_hash` column). The new `client_secret_sha256` column
is empty for existing apps. You must **rotate the client secret** once via the
admin panel or API so that the SHA-256 hash gets populated:

```bash
# Via the hub API (as admin)
curl -X POST https://hub.labf.app/api/apps/{app-id}/rotate-secret \
  -H "X-User-Id: 1"
```

This returns the new plaintext secret. Update writing-buddy's `.env`:

```env
OIDC_CLIENT_SECRET=<new-plaintext-secret-from-rotation>
```

After rotation, both `client_secret_hash` (bcrypt) and `client_secret_sha256`
(SHA-256) are stored. The OIDC flow uses SHA-256; the bcrypt hash remains for
backward compatibility with other admin API operations.

### 2. Token Endpoint Auth Method: `client_secret_basic` → `client_secret_post`

**What:** The hub now registers clients with `token_endpoint_auth_method: 'client_secret_post'`
instead of `client_secret_basic`.

**Why:** `client_secret_post` sends the secret in the POST body
(`application/x-www-form-urlencoded`), which is easier to intercept and hash
in the middleware. `client_secret_basic` uses the `Authorization` header with
Base64 encoding, which adds unnecessary complexity.

**Impact on writing-buddy:** Writing-buddy uses `JwtVerifier` for Bearer token
verification — it verifies tokens using the JWKS endpoint, not the token
endpoint. The `JwtVerifier` does not call the token endpoint at all, so
this change has **no impact** on writing-buddy's current auth pattern.

If writing-buddy ever switches to session-based auth (using `createAuthRoutes`),
the `@danwangdev/auth-client` SDK already sends secrets via POST body, which is
compatible.

### 3. Entitlement Enforcement at the Hub

**What:** The hub now checks whether a user has access to the requesting
application during the OIDC login flow, *before* issuing tokens.

**Why:** Previously, any authenticated user could complete the OIDC flow for
any registered client and receive tokens — even if their subscription plan
didn't include that app. The entitlement check was only done client-side
(checking the `apps` claim), which is bypassable.

**How it works now:**

```
1. User visits writing-buddy → redirected to hub for login
2. User authenticates at hub
3. Hub checks: does this user's subscription include "writing-buddy"?
   - YES → issues authorization code, user proceeds
   - NO  → shows "Access Denied — upgrade your plan" page
4. User never receives tokens for apps they can't access
```

**Impact on writing-buddy:** This is defense-in-depth. Writing-buddy should
**continue** checking the `apps` claim as a safety net. Currently,
writing-buddy uses `JwtVerifier` which verifies Bearer tokens sent by the
frontend. The frontend obtains these tokens from the hub via the OIDC flow
(handled by the React auth client). The hub's entitlement check blocks the
OIDC flow before the frontend ever gets a token, so writing-buddy's backend
will never see a token for an unentitled user (in theory).

However, as defense-in-depth, verify the claim in your auth middleware:

```typescript
const claims = req.user; // from hub-auth middleware
if (!claims.apps.includes('writing-buddy')) {
  res.status(403).json({ error: 'No access to this application' });
  return;
}
```

### 4. Auto-Consent for First-Party Apps

**What:** The hub now automatically grants consent for all registered client
apps, skipping the "Authorize — allow/deny" screen.

**Why:** Writing-buddy is a first-party app. Showing a consent screen is
confusing for users — they already trust the app.

**Impact on writing-buddy:** None. The consent prompt was an extra step.
Removing it makes the flow faster and smoother.

### 5. RP-Initiated Logout

**What:** The hub now supports the OIDC RP-Initiated Logout specification.
A new endpoint exists at `/auth/logout` that redirects to the OIDC
`/oidc/session/end` endpoint.

**Why:** When a user logs out, we want to destroy their hub session so they're
logged out of all apps (single sign-out).

**Impact on writing-buddy:** Writing-buddy uses `JwtVerifier` (Bearer tokens),
not session-based auth. The frontend handles login/logout via the React auth
client (`@danwangdev/auth-client/react`), which should redirect to the hub's
logout endpoint on sign-out.

If the frontend's logout flow currently only clears the local token, update it
to also redirect to the hub:

```typescript
// Frontend logout handler
function handleLogout() {
  // Clear local state
  clearTokens();

  // Redirect to hub logout for single sign-out
  window.location.href = `${HUB_ISSUER}/auth/logout?post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
}
```

### 6. New Claim: `expires_at`

**What:** The hub's id_token now includes an `expires_at` claim in the `hub`
scope, representing when the user's subscription expires.

**Why:** This lets client apps show subscription expiry warnings without making
a separate API call to the hub.

**Value format:** ISO 8601 string (`"2027-01-01T00:00:00.000Z"`) or `null` if
the subscription has no expiry.

**Impact on writing-buddy:**

1. **Update `@danwangdev/auth-client`** — Add `expires_at` to the `HubUser`
   and `HubTokenClaims` interfaces:

   ```typescript
   interface HubUser {
     // ... existing fields ...
     readonly expires_at: string | null;
   }

   interface HubTokenClaims {
     // ... existing fields ...
     readonly expires_at: string | null;
   }
   ```

2. **Optional UI enhancement** — Show expiry warnings in the writing interface.

### 7. CORS Tightening

**What:** The hub's OIDC provider now restricts CORS to origins matching
registered client redirect URIs.

**Why:** Security hardening. Only known client origins can make cross-origin
requests to OIDC endpoints.

**Impact on writing-buddy:** None, as long as writing-buddy's origins
(`https://writing-buddy.labf.app` and `http://localhost:5175`) are in the
hub's `redirect_uris`. This is already the case.

---

## Writing-Buddy Auth Architecture Note

Writing-buddy uses a **split auth pattern**:

```
┌─────────────────────┐
│  Writing Buddy      │
│  Frontend (React)   │
│                     │
│  Uses auth-client/  │  ← Handles OIDC flow, stores tokens
│  react for login    │
│                     │
│  Sends Bearer token │
│  to backend API     │
└────────┬────────────┘
         │
         │ Authorization: Bearer <id_token>
         │ (or accessToken cookie)
         ▼
┌─────────────────────┐
│  Writing Buddy      │
│  Backend (Express)  │
│                     │
│  Uses JwtVerifier   │  ← Verifies JWT signature via JWKS
│  from auth-client/  │
│  server             │
│                     │
│  Syncs user to      │
│  local app_users    │
│  table              │
└─────────────────────┘
```

The frontend does the OIDC dance (redirect to hub, receive callback with code,
exchange for tokens). The backend only verifies the resulting JWT. This means:

- **Token endpoint changes** (client_secret, auth method) only affect the
  frontend's OIDC flow, which is handled by `@danwangdev/auth-client/react`.
- **Backend auth** (`JwtVerifier`) only uses the JWKS endpoint for signature
  verification — it never calls the token endpoint.
- **User sync** happens in `hub-auth.ts` via the `onAuthenticated` callback,
  which writes hub claims to the local `app_users` table.

---

## Action Items Checklist

### Required (before deploying the hub update)

- [ ] **Rotate client secret** via the hub admin panel or API. Update
      writing-buddy's `.env` with the new plaintext secret.

### Required (auth-client SDK update)

- [ ] **Add `expires_at: string | null`** to `HubUser` and `HubTokenClaims`
      interfaces in the `@danwangdev/auth-client` package. Publish a new version.

- [ ] **Update `@danwangdev/auth-client` dependency** in writing-buddy to the
      new version.

### Recommended

- [ ] **Verify frontend logout** redirects to hub's `/auth/logout` endpoint
      for single sign-out (not just clearing local tokens).

- [ ] **Add defense-in-depth entitlement check** in the backend auth middleware:
      verify `claims.apps.includes('writing-buddy')`.

### Optional

- [ ] Show subscription expiry warnings using the `expires_at` claim.

### No Action Required

- Token endpoint auth method change (JwtVerifier doesn't use it)
- Auto-consent (transparent)
- Entitlement enforcement at hub (transparent)
- CORS tightening (existing redirect URIs cover the allowed origins)
- User sync logic (unchanged — `hub-auth.ts` and `onAuthenticated` callback)

---

## Environment Variables Reference

These are the env vars writing-buddy needs for hub OIDC integration:

| Variable | Example | Description |
|----------|---------|-------------|
| `OIDC_ISSUER` | `https://hub.labf.app` | Public issuer URL (must match `iss` claim in tokens) |
| `OIDC_INTERNAL_ISSUER` | `http://app:3009` | Internal Docker URL for JWKS fetch (falls back to `OIDC_ISSUER`) |
| `OIDC_CLIENT_ID` | `writing-buddy-client` | Client ID registered in hub |
| `OIDC_CLIENT_SECRET` | `<64-char-hex-string>` | Plaintext client secret (from rotation) |
| `OIDC_REDIRECT_URI` | `https://writing-buddy.labf.app/auth/callback` | Callback URL registered in hub |
| `SESSION_SECRET` | `<32+-char-string>` | Secret for encrypting the session cookie |

---

## Troubleshooting

### "Invalid client authentication" at token endpoint

The `client_secret_sha256` column is empty for this application. Rotate the
secret via the admin panel to populate it.

### "Access Denied — upgrade your plan" after login

The user's subscription doesn't include writing-buddy. Check the user's plan
in the admin panel. Plans that include writing-buddy: `writing`, `bundle`, `family`.

### CORS errors on OIDC endpoints

Verify that writing-buddy's origin is in the `redirect_uris` for the
application in the hub database.

### id_token missing `expires_at` claim

Update `@danwangdev/auth-client` to the latest version. The claim is always
present in the token but the SDK type must be updated to expose it.

### Backend JWT verification fails after hub restart

If the hub is using an ephemeral dev signing key (`OIDC_SIGNING_KEY` not set),
all previously issued tokens become invalid when the hub restarts. In production,
always set `OIDC_SIGNING_KEY` to a persisted RSA JWK.
