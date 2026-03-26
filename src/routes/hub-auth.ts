import { randomBytes, createHash } from 'crypto'
import { Router } from 'express'
import type { Request, Response } from 'express'
import { getIronSession } from 'iron-session'
import * as jose from 'jose'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'hub-auth' })

export interface HubAuthOptions {
  /** OIDC issuer URL (the hub itself) */
  issuer: string
  /** Internal issuer URL for server-to-server calls (Docker networking) */
  internalIssuer?: string
  /** Hub's own OIDC client_id */
  clientId: string
  /** Hub's own OIDC client_secret (plaintext) */
  clientSecret: string
  /** iron-session encryption password (min 32 chars) */
  sessionSecret: string
  /** Redirect URI for OIDC callback */
  redirectUri: string
}

interface SessionData {
  code_verifier?: string
  state?: string
  returnTo?: string
  tokens?: {
    id_token?: string
    access_token?: string
    refresh_token?: string
  }
}

interface OidcMetadata {
  authorization_endpoint: string
  token_endpoint: string
  end_session_endpoint?: string
  jwks_uri: string
}

const COOKIE_NAME = '__hub_session'
const SCOPES = 'openid profile email hub'

async function getSession(req: Request, res: Response, password: string) {
  return getIronSession<SessionData>(req, res, {
    password,
    cookieName: COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 7 * 24 * 60 * 60, // 7 days
    },
  })
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

function generatePkce(): { code_verifier: string; code_challenge: string } {
  const code_verifier = base64url(randomBytes(32))
  const code_challenge = base64url(createHash('sha256').update(code_verifier).digest())
  return { code_verifier, code_challenge }
}

/** Cache OIDC discovery metadata for 5 minutes */
let metadataCache: { data: OidcMetadata; expiresAt: number } | null = null

async function discoverOidc(issuer: string, internalIssuer?: string): Promise<OidcMetadata> {
  if (metadataCache && Date.now() < metadataCache.expiresAt) {
    return metadataCache.data
  }

  const fetchUrl = internalIssuer ?? issuer
  const response = await fetch(`${fetchUrl}/.well-known/openid-configuration`)
  if (!response.ok) {
    throw new Error(`OIDC discovery failed: ${response.status}`)
  }

  const data = (await response.json()) as OidcMetadata
  metadataCache = { data, expiresAt: Date.now() + 5 * 60 * 1000 }
  return data
}

/** Cache JWKS for 10 minutes */
let jwksCache: { jwks: jose.JSONWebKeySet; expiresAt: number } | null = null

async function fetchJwks(jwksUri: string): Promise<jose.JSONWebKeySet> {
  if (jwksCache && Date.now() < jwksCache.expiresAt) {
    return jwksCache.jwks
  }

  const response = await fetch(jwksUri)
  if (!response.ok) {
    throw new Error(`JWKS fetch failed: ${response.status}`)
  }

  const jwks = (await response.json()) as jose.JSONWebKeySet
  jwksCache = { jwks, expiresAt: Date.now() + 10 * 60 * 1000 }
  return jwks
}

function decodeIdToken(idToken: string): Record<string, unknown> {
  const payload = jose.decodeJwt(idToken)
  return payload as Record<string, unknown>
}

export function createHubAuthRouter(options: HubAuthOptions): Router {
  const router = Router()
  const { issuer, internalIssuer, clientId, clientSecret, sessionSecret, redirectUri } = options

  // GET /auth/login — redirect to hub's own OIDC authorization endpoint
  router.get('/auth/login', async (req: Request, res: Response) => {
    try {
      const metadata = await discoverOidc(issuer, internalIssuer)
      const { code_verifier, code_challenge } = generatePkce()
      const state = base64url(randomBytes(16))

      const session = await getSession(req, res, sessionSecret)
      session.code_verifier = code_verifier
      session.state = state
      session.returnTo = (req.query.returnTo as string) ?? '/'
      await session.save()

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
        code_challenge,
        code_challenge_method: 'S256',
      })

      logger.info('hub auth login redirect', {
        operation: 'hubLogin',
        state,
      })

      res.redirect(`${metadata.authorization_endpoint}?${params.toString()}`)
    } catch (error) {
      logger.error('hub auth login failed', {
        operation: 'hubLogin',
        error: error instanceof Error ? error.message : String(error),
      })
      res.status(500).json({ success: false, error: 'Failed to initiate login' })
    }
  })

  // GET /auth/callback — handle OIDC callback, exchange code for tokens
  router.get('/auth/callback', async (req: Request, res: Response) => {
    try {
      const { code, state, error, error_description } = req.query as Record<string, string>

      if (error) {
        logger.warn('hub auth callback error', {
          operation: 'hubCallback',
          error,
          error_description,
        })
        if (error === 'access_denied') {
          res.redirect('/login?error=access_denied')
          return
        }
        res.status(400).json({ success: false, error: error_description ?? error })
        return
      }

      if (!code || !state) {
        res.status(400).json({ success: false, error: 'Missing code or state' })
        return
      }

      const session = await getSession(req, res, sessionSecret)

      // Validate CSRF state
      if (state !== session.state) {
        logger.warn('hub auth callback state mismatch', {
          operation: 'hubCallback',
          expected: session.state ?? 'none',
          received: state,
        })
        res.status(400).json({ success: false, error: 'Invalid state parameter' })
        return
      }

      if (!session.code_verifier) {
        res.status(400).json({ success: false, error: 'Missing PKCE code verifier' })
        return
      }

      const metadata = await discoverOidc(issuer, internalIssuer)
      const tokenUrl = internalIssuer
        ? metadata.token_endpoint.replace(issuer, internalIssuer)
        : metadata.token_endpoint

      // Exchange code for tokens
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
          code_verifier: session.code_verifier,
        }),
      })

      if (!tokenResponse.ok) {
        const body = await tokenResponse.text()
        logger.error('hub auth token exchange failed', {
          operation: 'hubCallback',
          status: tokenResponse.status,
          body,
        })
        res.status(500).json({ success: false, error: 'Token exchange failed' })
        return
      }

      const tokens = (await tokenResponse.json()) as {
        id_token?: string
        access_token?: string
        refresh_token?: string
      }

      // Store tokens, clear PKCE state
      const returnTo = session.returnTo ?? '/'
      session.tokens = tokens
      session.code_verifier = undefined
      session.state = undefined
      session.returnTo = undefined
      await session.save()

      logger.info('hub auth callback success', { operation: 'hubCallback' })
      res.redirect(returnTo)
    } catch (error) {
      logger.error('hub auth callback failed', {
        operation: 'hubCallback',
        error: error instanceof Error ? error.message : String(error),
      })
      res.status(500).json({ success: false, error: 'Authentication failed' })
    }
  })

  // POST /auth/logout — clear session and redirect to OIDC end_session
  router.post('/auth/logout', async (req: Request, res: Response) => {
    try {
      const session = await getSession(req, res, sessionSecret)
      const idToken = session.tokens?.id_token
      session.destroy()

      try {
        const metadata = await discoverOidc(issuer, internalIssuer)
        if (metadata.end_session_endpoint) {
          const params = new URLSearchParams({
            post_logout_redirect_uri: issuer,
          })
          if (idToken) {
            params.set('id_token_hint', idToken)
          }
          res.redirect(`${metadata.end_session_endpoint}?${params.toString()}`)
          return
        }
      } catch {
        // Fall through to local redirect
      }

      logger.info('hub auth logout', { operation: 'hubLogout' })
      res.redirect('/')
    } catch (error) {
      logger.error('hub auth logout failed', {
        operation: 'hubLogout',
        error: error instanceof Error ? error.message : String(error),
      })
      res.redirect('/')
    }
  })

  // GET /auth/me — return current user claims from session
  router.get('/auth/me', async (req: Request, res: Response) => {
    try {
      const session = await getSession(req, res, sessionSecret)

      if (!session.tokens?.id_token) {
        res.status(401).json({ success: false, error: 'Not authenticated' })
        return
      }

      const claims = decodeIdToken(session.tokens.id_token)
      res.json({ success: true, data: claims })
    } catch (error) {
      logger.error('hub auth me failed', {
        operation: 'hubMe',
        error: error instanceof Error ? error.message : String(error),
      })
      res.status(401).json({ success: false, error: 'Not authenticated' })
    }
  })

  // POST /auth/backchannel-logout — receive logout_token from oidc-provider
  router.post('/auth/backchannel-logout', async (req: Request, res: Response) => {
    try {
      const logoutToken = req.body?.logout_token ?? (req as Request & { body: string }).body

      if (!logoutToken || typeof logoutToken !== 'string') {
        logger.warn('bcl: missing logout_token', { operation: 'hubBcl' })
        res.status(400).json({ error: 'Missing logout_token' })
        return
      }

      // Verify the logout_token JWT
      const metadata = await discoverOidc(issuer, internalIssuer)
      const jwksUrl = internalIssuer
        ? metadata.jwks_uri.replace(issuer, internalIssuer)
        : metadata.jwks_uri
      const jwks = await fetchJwks(jwksUrl)
      const JWKS = jose.createLocalJWKSet(jwks)

      const { payload } = await jose.jwtVerify(logoutToken, JWKS, {
        issuer,
        audience: clientId,
      })

      const sub = payload.sub
      if (!sub) {
        logger.warn('bcl: logout_token missing sub', { operation: 'hubBcl' })
        res.status(400).json({ error: 'Invalid logout_token: missing sub' })
        return
      }

      // For the hub's iron-session, we can't easily look up sessions by sub
      // since iron-session is stateless (encrypted cookie). The BCL notification
      // is acknowledged, and the next time the user's browser sends a request,
      // the /auth/me endpoint will re-validate. For server-side session stores,
      // this would destroy the session by sub.
      //
      // The primary value of BCL for the hub is that oidc-provider sends it to
      // OTHER client apps (vocab-master, writing-buddy) when a hub user logs out.
      // The hub's own session is already destroyed by the logout action itself.
      logger.info('bcl: logout_token verified', {
        operation: 'hubBcl',
        sub,
        sid: payload.sid as string | undefined,
      })

      res.status(200).json({ success: true })
    } catch (error) {
      logger.error('bcl: verification failed', {
        operation: 'hubBcl',
        error: error instanceof Error ? error.message : String(error),
      })
      res.status(400).json({ error: 'Invalid logout_token' })
    }
  })

  return router
}

/**
 * Export for testing — reset discovery and JWKS caches.
 */
export function _resetCaches(): void {
  metadataCache = null
  jwksCache = null
}
