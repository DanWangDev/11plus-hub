# OIDC SSO Integration Guide — Vocab Master

This document describes the changes made to the 11plus-hub's OIDC provider
and what (if anything) needs to change in vocab-master to stay compatible.

## TL;DR

**Almost nothing changes in vocab-master.** The hub's OIDC changes are
backwards-compatible with the current `@danwangdev/auth-client` integration.
The main action item is a one-time secret rotation and a minor type update.

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

This returns the new plaintext secret. Update vocab-master's `.env`:

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

**Impact on vocab-master:** None. The `@danwangdev/auth-client` SDK already
sends `client_secret` in the POST body (lines 141-142 of the compiled
`exchangeCode` function). This is `client_secret_post` behavior. The SDK was
already doing the right thing — it just wasn't declared as such on the hub side.

### 3. Entitlement Enforcement at the Hub

**What:** The hub now checks whether a user has access to the requesting
application during the OIDC login flow, *before* issuing tokens.

**Why:** Previously, any authenticated user could complete the OIDC flow for
any registered client and receive tokens — even if their subscription plan
didn't include that app. The entitlement check was only done client-side
(checking the `apps` claim), which is bypassable.

**How it works now:**

```
1. User visits vocab-master → redirected to hub for login
2. User authenticates at hub
3. Hub checks: does this user's subscription include "vocab-master"?
   - YES → issues authorization code, user proceeds
   - NO  → shows "Access Denied — upgrade your plan" page
4. User never receives tokens for apps they can't access
```

The entitlement is checked by looking up the `user_app_access` table (which is
synced from the user's subscription plan). The `checkEntitlement(sql, userId, 'vocab-master')`
function is called with the application's slug derived from the `client_id` in
the OIDC authorization request.

**Impact on vocab-master:** This is defense-in-depth. Vocab-master should
**continue** checking the `apps` claim in the id_token as a safety net:

```typescript
const claims = req.user; // from auth middleware
if (!claims.apps.includes('vocab-master')) {
  // This should rarely happen (hub blocks it), but handle gracefully
  res.status(403).json({ error: 'No access to this application' });
  return;
}
```

### 4. Auto-Consent for First-Party Apps

**What:** The hub now automatically grants consent for all registered client
apps, skipping the "Authorize — allow/deny" screen.

**Why:** Vocab-master is a first-party app (owned by the same organization as
the hub). Showing a consent screen asking the user to "allow Vocab Master to
access your profile" is confusing UX for a first-party app — the user already
trusts it. Auth0, Google Workspace, and other identity providers skip consent
for first-party apps.

**How it works:** The hub uses oidc-provider's `loadExistingGrant` configuration
to automatically create a grant with all scopes (`openid profile email hub`)
when no existing grant is found. This means:

- First login: user enters credentials → tokens issued immediately (no consent)
- Subsequent visits: OIDC session cookie exists → tokens issued silently (SSO)

**Impact on vocab-master:** None. The consent prompt was an extra step that the
user had to click through. Removing it makes the flow faster.

### 5. RP-Initiated Logout

**What:** The hub now supports the OIDC RP-Initiated Logout specification.
A new endpoint exists at `/auth/logout` that redirects to the OIDC
`/oidc/session/end` endpoint.

**Why:** When a user logs out of vocab-master, we want to also destroy their
hub session so they're logged out of all apps (single sign-out). Without this,
logging out of vocab-master would only clear the local session — the user would
still be logged into the hub and other apps.

**How it works:**

```
1. User clicks "Logout" in vocab-master
2. Vocab-master clears its local session
3. Vocab-master redirects to: hub.labf.app/auth/logout
     ?id_token_hint=<id_token>
     &post_logout_redirect_uri=https://vocab-master.labf.app
4. Hub destroys the OIDC session
5. Hub redirects back to vocab-master's URL
```

**Impact on vocab-master:** The `@danwangdev/auth-client` SDK's `createAuthRoutes`
function already generates a `POST /auth/logout` route that redirects to the
hub's end-session endpoint. If you're using `createAuthRoutes`, this works
automatically.

If you're using the `JwtVerifier` pattern (Bearer token verification without
session routes), you'll need to add a logout route manually that redirects to
the hub's `/auth/logout` endpoint.

### 6. New Claim: `expires_at`

**What:** The hub's id_token now includes an `expires_at` claim in the `hub`
scope, representing when the user's subscription expires.

**Why:** This lets client apps show subscription expiry warnings (e.g., "Your
plan expires in 3 days") without making a separate API call to the hub.

**Value format:** ISO 8601 string (`"2027-01-01T00:00:00.000Z"`) or `null` if
the subscription has no expiry.

**Impact on vocab-master:**

1. **Update `@danwangdev/auth-client`** — Add `expires_at` to the `HubUser`
   interface:

   ```typescript
   interface HubUser {
     // ... existing fields ...
     readonly expires_at: string | null;
   }
   ```

2. **Optional UI enhancement** — Show a warning banner when the subscription
   is about to expire:

   ```typescript
   const expiresAt = claims.expires_at ? new Date(claims.expires_at) : null;
   const daysLeft = expiresAt
     ? Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
     : null;

   if (daysLeft !== null && daysLeft <= 7) {
     // Show "Your plan expires in X days" banner
   }
   ```

### 7. CORS Tightening

**What:** The hub's OIDC provider now restricts CORS to origins that match
registered client redirect URIs, instead of allowing all origins.

**Why:** The previous `clientBasedCORS: () => true` allowed any origin to make
cross-origin requests to the OIDC endpoints. This is unnecessary and a security
risk. The new policy only allows origins derived from the `redirect_uris`
configured for each client.

**Impact on vocab-master:** None, as long as vocab-master's origin
(`https://vocab-master.labf.app` and `http://localhost:5174` for dev) is
registered in the hub's `redirect_uris` for the vocab-master application.
This is already the case from the seed data.

---

## Action Items Checklist

### Required (before deploying the hub update)

- [ ] **Rotate client secret** via the hub admin panel or API. Update
      vocab-master's `.env` with the new plaintext secret. This populates the
      `client_secret_sha256` column that the OIDC flow now uses.

### Required (auth-client SDK update)

- [ ] **Add `expires_at: string | null` to `HubUser` interface** in the
      `@danwangdev/auth-client` package. Publish a new version.

- [ ] **Update `@danwangdev/auth-client` dependency** in vocab-master to the
      new version.

### Optional (nice-to-have)

- [ ] Show subscription expiry warnings using the `expires_at` claim.

- [ ] Verify that the client-side entitlement check (`apps.includes('vocab-master')`)
      exists as a defense-in-depth measure.

### No Action Required

- Token endpoint auth method change (SDK already uses `client_secret_post`)
- Auto-consent (transparent, no code changes)
- Entitlement enforcement at hub (transparent, defense-in-depth)
- CORS tightening (existing redirect URIs cover the allowed origins)
- RP-initiated logout (SDK already handles this if using `createAuthRoutes`)

---

## Architecture Overview

```
┌──────────────────┐     ┌───────────────────────────┐
│                  │     │        11plus-hub          │
│   Vocab Master   │     │                           │
│   (RP client)    │     │  ┌─────────────────────┐  │
│                  │     │  │   OIDC Provider      │  │
│  1. No session?  │────▶│  │                     │  │
│     Redirect to  │     │  │  2. Login prompt     │  │
│     hub /oidc/   │     │  │  3. Entitlement ✓    │  │
│     auth         │     │  │  4. Auto-consent     │  │
│                  │◀────│  │  5. Issue tokens     │  │
│  6. Exchange     │     │  └─────────────────────┘  │
│     code for     │────▶│                           │
│     tokens       │     │  Secret Auth Middleware:   │
│                  │◀────│  SHA-256(incoming) = stored│
│  7. Create local │     │                           │
│     session      │     │  Claims in id_token:       │
│                  │     │  { sub, username, email,   │
│  8. User is in   │     │    plan, features, apps,  │
│                  │     │    expires_at }            │
└──────────────────┘     └───────────────────────────┘
```

---

## Environment Variables Reference

These are the env vars vocab-master needs for hub OIDC integration:

| Variable | Example | Description |
|----------|---------|-------------|
| `OIDC_ISSUER` | `https://hub.labf.app` | Public issuer URL (must match `iss` claim in tokens) |
| `OIDC_INTERNAL_ISSUER` | `http://app:3009` | Internal Docker network URL for discovery (falls back to `OIDC_ISSUER`) |
| `OIDC_CLIENT_ID` | `vocab-master-client` | Client ID registered in hub's applications table |
| `OIDC_CLIENT_SECRET` | `<64-char-hex-string>` | Plaintext client secret (from secret rotation) |
| `OIDC_REDIRECT_URI` | `https://vocab-master.labf.app/auth/callback` | Callback URL registered in hub |
| `SESSION_SECRET` | `<32+-char-string>` | Secret for encrypting the session cookie |

---

## Troubleshooting

### "Invalid client authentication" at token endpoint

The `client_secret_sha256` column is empty for this application. Rotate the
secret via the admin panel to populate it.

### "Access Denied — upgrade your plan" after login

The user's subscription doesn't include vocab-master access. Check the
`user_app_access` table in the hub database, or the user's subscription plan
in the admin panel. Plans that include vocab-master: `vocab`, `bundle`, `family`.

### CORS errors on OIDC endpoints

Verify that vocab-master's origin is in the `redirect_uris` for the application
in the hub database. The hub derives allowed CORS origins from these URIs.

### id_token missing `expires_at` claim

Update `@danwangdev/auth-client` to the latest version that includes the
`expires_at` field in the `HubUser` type. The claim is always present in the
token (as `null` or an ISO string), but the SDK type must be updated to access it.
