import Provider from 'oidc-provider'
import type postgres from 'postgres'
import { createPgAdapter } from './pg-adapter.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-provider' })

export interface OidcProviderOptions {
  issuer: string
  sql: postgres.Sql
  signingKey: string
  cookieKeys: string[]
  findAccount: (
    ctx: unknown,
    sub: string,
  ) => Promise<
    | {
        accountId: string
        claims: () => Promise<Record<string, unknown>>
      }
    | undefined
  >
}

export function createOidcProvider(options: OidcProviderOptions): Provider {
  const { issuer, sql, signingKey, cookieKeys, findAccount } = options

  const adapter = createPgAdapter(sql)

  const provider = new Provider(issuer, {
    adapter,

    // Clients are loaded dynamically by the adapter's Client model
    // (see pg-adapter.ts createClientAdapter) — no static registration needed.

    findAccount: async (ctx, sub) => {
      const account = await findAccount(ctx, sub)
      if (!account) {
        logger.warn('account not found for OIDC', { sub })
        return undefined
      }
      return account
    },

    claims: {
      openid: ['sub'],
      profile: ['username', 'display_name', 'role'],
      email: ['email', 'email_verified'],
      hub: ['plan', 'features', 'apps', 'expires_at'],
    },

    scopes: ['openid', 'profile', 'email', 'hub'],

    // Include all requested claims in id_token (not just at userinfo)
    // This lets client apps verify the id_token locally with full user data
    conformIdTokenClaims: false,

    features: {
      devInteractions: { enabled: false },
      resourceIndicators: { enabled: false },
      rpInitiatedLogout: {
        enabled: true,
        // Auto-submit the logout confirmation form so users don't see
        // the ugly default "Do you want to sign out?" page.
        logoutSource: async (ctx: { body: string }, form: string) => {
          // Helmet CSP is skipped for /oidc/ routes (see app.ts), so
          // inline scripts and form submissions work without overrides.
          //
          // IMPORTANT: oidc-provider's form only includes the xsrf token.
          // The "logout" field must be added explicitly — without it, the
          // confirm endpoint only rotates the session ID instead of
          // destroying it (see end_session.js: `if (params.logout)`).
          const formWithLogout = form.replace(
            '</form>',
            '<input type="hidden" name="logout" value="yes"/></form>',
          )
          ctx.body = `<!DOCTYPE html>
<html><head><title>Signing out...</title></head>
<body>
  ${formWithLogout}
  <script>document.forms[0].submit()</script>
  <noscript>
    <p>Your browser does not support JavaScript. Click the button below to sign out.</p>
    ${formWithLogout}
  </noscript>
</body></html>`
        },
        // When post_logout_redirect_uri doesn't match any registered URI
        // (e.g. app.url in DB is localhost but issuer is the production domain),
        // redirect to /login instead of showing the default ugly success page.
        postLogoutSuccessSource: async (ctx: { body: string }) => {
          ctx.body = `<!DOCTYPE html>
<html><head><meta http-equiv="refresh" content="0;url=/login"></head>
<body><p>Signed out. <a href="/login">Return to login</a></p></body></html>`
        },
      },
      backchannelLogout: { enabled: true },
    },

    // Short timeout for backchannel logout HTTP requests to prevent
    // the logout flow from hanging when a client is unreachable.
    httpOptions: () => ({ timeout: { request: 2500 } }),

    // Always issue refresh tokens for confidential first-party clients.
    // This avoids requiring `offline_access` scope in every authorization request.
    issueRefreshToken: async (_ctx, client, code) => {
      if (client.grantTypeAllowed('refresh_token') && code.scopes.has('openid')) {
        return true
      }
      return false
    },

    // Auto-consent for first-party apps — skip the consent screen entirely.
    // All registered clients are first-party (our own apps). If third-party
    // clients are ever added, gate this on a `first_party` column.
    loadExistingGrant: async (ctx) => {
      const grantId =
        ctx.oidc.result?.consent?.grantId ||
        (ctx.oidc.session?.accountId
          ? ctx.oidc.session.grantIdFor(ctx.oidc.client!.clientId)
          : undefined)

      if (grantId) {
        return ctx.oidc.provider.Grant.find(grantId)
      }

      // Auto-create a grant with all scopes for first-party clients
      const grant = new ctx.oidc.provider.Grant({
        accountId: ctx.oidc.session!.accountId!,
        clientId: ctx.oidc.client!.clientId,
      })

      grant.addOIDCScope('openid profile email hub')
      grant.addOIDCClaims([
        'sub',
        'username',
        'display_name',
        'email',
        'email_verified',
        'role',
        'plan',
        'features',
        'apps',
        'expires_at',
      ])

      await grant.save()
      return grant
    },

    pkce: {
      methods: ['S256'],
      required: () => true,
    },

    cookies: {
      keys: cookieKeys,
      long: {
        httpOnly: true,
        sameSite: 'lax' as const,
        signed: true,
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
      short: {
        httpOnly: true,
        sameSite: 'lax' as const,
        signed: true,
        path: '/',
      },
    },

    ttl: {
      AccessToken: 15 * 60, // 15 minutes
      AuthorizationCode: 60, // 1 minute
      RefreshToken: 7 * 24 * 60 * 60, // 7 days
      Session: 7 * 24 * 60 * 60, // 7 days
      Interaction: 60 * 60, // 1 hour
      Grant: 7 * 24 * 60 * 60, // 7 days
      IdToken: 60 * 60, // 1 hour
    },

    jwks: {
      keys: [JSON.parse(signingKey)],
    },

    interactions: {
      url: (_ctx, interaction) => {
        return `/auth/interaction/${interaction.uid}`
      },
    },

    renderError: async (ctx, out, _error) => {
      logger.error('oidc render error', {
        operation: 'renderError',
        error: out.error,
        errorDescription: out.error_description,
        fullOut: JSON.stringify(out),
        originalError: _error instanceof Error ? _error.message : String(_error),
        stack: _error instanceof Error ? _error.stack : undefined,
      })

      ctx.type = 'html'
      ctx.body = `<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body>
  <h1>Authentication Error</h1>
  <p>${(out.error_description ?? out.error ?? 'An unknown error occurred').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</p>
  <a href="/">Return to home</a>
</body>
</html>`
    },

    clientBasedCORS: (_ctx, origin, client) => {
      // Allow CORS from origins that match a registered client's redirect URIs
      const allowedOrigins = (client.redirectUris ?? []).map((uri: string) => {
        try {
          const url = new URL(uri)
          return url.origin
        } catch {
          return ''
        }
      })
      return allowedOrigins.includes(origin)
    },
  })

  // Trust X-Forwarded-Proto / X-Forwarded-For headers from the reverse proxy
  // (Cloudflare tunnel). Without this, oidc-provider generates http:// URLs
  // in discovery metadata and logout forms. When the logout confirmation form
  // POSTs to http://, Cloudflare's 301 redirect converts POST → GET, so the
  // provider never processes the confirmation and the session survives.
  provider.proxy = true

  provider.on('grant.success', (...args: unknown[]) => {
    const ctx = args[0] as { oidc?: { client?: { clientId?: string } } }
    logger.info('oidc grant success', {
      operation: 'grant.success',
      clientId: ctx.oidc?.client?.clientId,
    })
  })

  provider.on('grant.error', (...args: unknown[]) => {
    const ctx = args[0] as { oidc?: { client?: { clientId?: string } } }
    const error = args[1] as Error
    logger.error('oidc grant error', {
      operation: 'grant.error',
      clientId: ctx.oidc?.client?.clientId,
      error: error.message,
    })
  })

  provider.on('backchannel.success', (...args: unknown[]) => {
    const ctx = args[0] as { oidc?: { client?: { clientId?: string } } }
    logger.info('backchannel logout success', {
      operation: 'backchannel.success',
      clientId: ctx.oidc?.client?.clientId,
    })
  })

  provider.on('backchannel.error', (...args: unknown[]) => {
    const ctx = args[0] as { oidc?: { client?: { clientId?: string } } }
    const error = args[1] as Error
    logger.warn('backchannel logout failed', {
      operation: 'backchannel.error',
      clientId: ctx.oidc?.client?.clientId,
      error: error.message,
    })
  })

  provider.on('server_error', (...args: unknown[]) => {
    const error = args[1] as Error
    logger.error('oidc server error', {
      operation: 'server_error',
      error: error.message,
      stack: error.stack,
    })
  })

  return provider
}
