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
      hub: ['plan', 'features', 'apps'],
    },

    scopes: ['openid', 'profile', 'email', 'hub'],

    // Include all requested claims in id_token (not just at userinfo)
    // This lets client apps verify the id_token locally with full user data
    conformIdTokenClaims: false,

    features: {
      devInteractions: { enabled: false },
      resourceIndicators: { enabled: false },
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
  <p>${out.error_description ?? out.error ?? 'An unknown error occurred'}</p>
  <a href="/">Return to home</a>
</body>
</html>`
    },

    clientBasedCORS: () => true,
  })

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
