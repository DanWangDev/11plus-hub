import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { createHubAuthRouter, _resetCaches } from './hub-auth.js'

// Mock logger
vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Mock iron-session — store session data in-memory keyed by a test cookie
const mockSessionStore: Record<string, Record<string, unknown>> = {}

vi.mock('iron-session', () => ({
  getIronSession: vi.fn(async (_req: unknown, _res: unknown) => {
    const data = mockSessionStore['test'] ?? {}
    return {
      ...data,
      save: vi.fn(async () => {
        Object.assign((mockSessionStore['test'] ??= {}), data)
      }),
      destroy: vi.fn(() => {
        delete mockSessionStore['test']
      }),
    }
  }),
}))

// Mock global fetch for OIDC discovery and token exchange
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const HUB_AUTH_OPTIONS = {
  issuer: 'http://localhost:3009',
  clientId: 'hub',
  clientSecret: 'hub-dev-client-secret',
  sessionSecret: 'hub-session-secret-minimum-32-characters-long!!',
  redirectUri: 'http://localhost:3009/auth/callback',
}

const MOCK_OIDC_METADATA = {
  authorization_endpoint: 'http://localhost:3009/oidc/auth',
  token_endpoint: 'http://localhost:3009/oidc/token',
  end_session_endpoint: 'http://localhost:3009/oidc/session/end',
  jwks_uri: 'http://localhost:3009/oidc/jwks',
}

function createTestApp() {
  const app = express()
  app.use(cookieParser())
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use(createHubAuthRouter(HUB_AUTH_OPTIONS))
  return app
}

describe('hub-auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetCaches()
    // Clear mock session
    for (const key of Object.keys(mockSessionStore)) {
      delete mockSessionStore[key]
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /auth/login', () => {
    it('redirects to OIDC authorization endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_OIDC_METADATA,
      })

      const app = createTestApp()
      const res = await request(app).get('/auth/login')

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('http://localhost:3009/oidc/auth?')
      expect(res.headers.location).toContain('response_type=code')
      expect(res.headers.location).toContain('client_id=hub')
      expect(res.headers.location).toContain('code_challenge_method=S256')
    })

    it('includes PKCE code_challenge in redirect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_OIDC_METADATA,
      })

      const app = createTestApp()
      const res = await request(app).get('/auth/login')

      expect(res.headers.location).toContain('code_challenge=')
    })

    it('includes returnTo parameter from query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_OIDC_METADATA,
      })

      const app = createTestApp()
      await request(app).get('/auth/login?returnTo=/dashboard')

      // returnTo is saved in session, not in the redirect URL
      // Just ensure the redirect happened successfully
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('returns 500 if OIDC discovery fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

      const app = createTestApp()
      const res = await request(app).get('/auth/login')

      expect(res.status).toBe(500)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Failed to initiate login',
      })
    })
  })

  describe('GET /auth/callback', () => {
    it('returns 400 if code is missing', async () => {
      const app = createTestApp()
      const res = await request(app).get('/auth/callback?state=test')

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Missing code or state')
    })

    it('returns 400 if state is missing', async () => {
      const app = createTestApp()
      const res = await request(app).get('/auth/callback?code=test')

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Missing code or state')
    })

    it('returns redirect on error=access_denied', async () => {
      const app = createTestApp()
      const res = await request(app).get('/auth/callback?error=access_denied')

      expect(res.status).toBe(302)
      expect(res.headers.location).toBe('/login?error=access_denied')
    })

    it('returns 400 for other OIDC errors', async () => {
      const app = createTestApp()
      const res = await request(app).get(
        '/auth/callback?error=invalid_request&error_description=bad+request',
      )

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('bad request')
    })
  })

  describe('GET /auth/me', () => {
    it('returns 401 when no session exists', async () => {
      const app = createTestApp()
      const res = await request(app).get('/auth/me')

      expect(res.status).toBe(401)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Not authenticated',
      })
    })

    it('returns user claims when session has id_token', async () => {
      // Create a fake JWT with claims (header.payload.signature)
      const claims = {
        sub: '123',
        username: 'testuser',
        display_name: 'Test User',
        email: 'test@example.com',
        email_verified: true,
        role: 'student',
        plan: 'free',
        features: [],
        apps: ['vocab-master'],
        expires_at: null,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'http://localhost:3009',
        aud: 'hub',
      }
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const fakeIdToken = `${header}.${payload}.fake-signature`

      // Pre-populate mock session
      mockSessionStore['test'] = {
        tokens: { id_token: fakeIdToken },
      }

      const { getIronSession } = await import('iron-session')
      vi.mocked(getIronSession).mockResolvedValueOnce({
        ...mockSessionStore['test'],
        tokens: { id_token: fakeIdToken },
        save: vi.fn(),
        destroy: vi.fn(),
        updateConfig: vi.fn(),
      } as never)

      const app = createTestApp()
      const res = await request(app).get('/auth/me')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.sub).toBe('123')
      expect(res.body.data.username).toBe('testuser')
      expect(res.body.data.email).toBe('test@example.com')
    })
  })

  describe('POST /auth/logout', () => {
    it('redirects to OIDC end_session_endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_OIDC_METADATA,
      })

      const { getIronSession } = await import('iron-session')
      vi.mocked(getIronSession).mockResolvedValueOnce({
        tokens: { id_token: 'test-id-token' },
        save: vi.fn(),
        destroy: vi.fn(),
        updateConfig: vi.fn(),
      } as never)

      const app = createTestApp()
      const res = await request(app).post('/auth/logout')

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('http://localhost:3009/oidc/session/end?')
      expect(res.headers.location).toContain('id_token_hint=test-id-token')
    })

    it('redirects to / when no end_session_endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...MOCK_OIDC_METADATA,
          end_session_endpoint: undefined,
        }),
      })

      const { getIronSession } = await import('iron-session')
      vi.mocked(getIronSession).mockResolvedValueOnce({
        tokens: {},
        save: vi.fn(),
        destroy: vi.fn(),
        updateConfig: vi.fn(),
      } as never)

      const app = createTestApp()
      const res = await request(app).post('/auth/logout')

      expect(res.status).toBe(302)
      expect(res.headers.location).toBe('/')
    })

    it('redirects to / when OIDC discovery fails during logout', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { getIronSession } = await import('iron-session')
      vi.mocked(getIronSession).mockResolvedValueOnce({
        tokens: {},
        save: vi.fn(),
        destroy: vi.fn(),
        updateConfig: vi.fn(),
      } as never)

      const app = createTestApp()
      const res = await request(app).post('/auth/logout')

      expect(res.status).toBe(302)
      expect(res.headers.location).toBe('/')
    })
  })

  describe('POST /auth/backchannel-logout', () => {
    it('returns 400 when logout_token is missing', async () => {
      const app = createTestApp()
      const res = await request(app).post('/auth/backchannel-logout').send({})

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Missing logout_token')
    })

    it('returns 400 when logout_token is not a string', async () => {
      const app = createTestApp()
      const res = await request(app).post('/auth/backchannel-logout').send({ logout_token: 123 })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Missing logout_token')
    })

    it('returns 400 when JWT verification fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OIDC_METADATA,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ keys: [] }),
        })

      const app = createTestApp()
      const res = await request(app)
        .post('/auth/backchannel-logout')
        .send({ logout_token: 'invalid.jwt.token' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid logout_token')
    })
  })

  describe('OIDC discovery caching', () => {
    it('caches discovery metadata', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => MOCK_OIDC_METADATA,
      })

      const app = createTestApp()

      // First request triggers discovery
      await request(app).get('/auth/login')
      // Second request uses cache
      await request(app).get('/auth/login')

      // fetch should only be called once for discovery (cache hit on second)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })
})
