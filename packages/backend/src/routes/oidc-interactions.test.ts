import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import type Provider from 'oidc-provider'
import type postgres from 'postgres'
import type * as AuditService from '../services/audit-service.js'
import { createInteractionRouter } from './oidc-interactions.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const { mockFindUserByEmail, mockFindUserByGoogleId, mockVerifyPassword } = vi.hoisted(() => ({
  mockFindUserByEmail: vi.fn(),
  mockFindUserByGoogleId: vi.fn(),
  mockVerifyPassword: vi.fn(),
}))

vi.mock('../services/user-service.js', () => ({
  createUser: vi.fn(),
  findUserByEmail: (...args: unknown[]) => mockFindUserByEmail(...args),
  findUserByGoogleId: (...args: unknown[]) => mockFindUserByGoogleId(...args),
  findUserByUsername: vi.fn(),
  generateUniqueUsername: vi.fn(),
  updateLastActive: vi.fn().mockResolvedValue(undefined),
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}))

vi.mock('../services/google-auth-service.js', () => ({
  isGoogleConfigured: vi.fn().mockReturnValue(true),
  verifyGoogleToken: vi.fn().mockResolvedValue({
    googleId: 'g-123',
    email: 'kid@example.com',
    name: 'Kid',
    emailVerified: true,
  }),
}))

vi.mock('../services/audit-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuditService>()
  return { ...actual, logAction: vi.fn().mockResolvedValue(undefined) }
})

vi.mock('../services/turnstile-service.js', () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue(true),
}))

function createFakeProvider() {
  return {
    interactionDetails: vi.fn(async () => ({
      prompt: { name: 'login', details: {} },
      params: {
        client_id: 'hub',
        scope: 'openid profile email hub',
        redirect_uri: 'https://hub.labf.app/cb',
      },
      session: undefined,
    })),
    interactionResult: vi.fn(async () => 'https://hub.labf.app/cb?code=abc'),
    Client: { find: vi.fn() },
  }
}

function createTestApp(
  provider: ReturnType<typeof createFakeProvider>,
  sql: postgres.Sql = {} as unknown as postgres.Sql,
) {
  const app = express()
  app.use(express.json())
  app.use(
    createInteractionRouter({
      provider: provider as unknown as Provider,
      sql,
    }),
  )
  return app
}

/** Minimal callable sql stub for the Google account-linking UPDATE path. */
function createSqlStub(rows: unknown[] = []) {
  return vi.fn().mockResolvedValue(rows) as unknown as postgres.Sql
}

const PASSWORD_USER = {
  id: 5,
  username: 'kid',
  email: 'kid@example.com',
  password_hash: 'hash',
  display_name: 'Kid',
  role: 'student',
  parent_id: null,
  google_id: null,
  email_verified: false,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  last_active_at: null,
}

const GOOGLE_USER = {
  id: 6,
  username: 'gkid',
  email: 'kid@example.com',
  password_hash: null,
  display_name: 'Kid',
  role: 'student',
  parent_id: null,
  google_id: 'g-123',
  email_verified: true,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  last_active_at: null,
}

describe('oidc interaction routes', () => {
  let provider: ReturnType<typeof createFakeProvider>
  let app: express.Express

  beforeEach(() => {
    vi.clearAllMocks()
    provider = createFakeProvider()
    app = createTestApp(provider)
  })

  describe('POST /api/auth/interaction/:uid/login', () => {
    it('completes a successful login with turnstile verification', async () => {
      mockFindUserByEmail.mockResolvedValue(PASSWORD_USER)
      mockVerifyPassword.mockResolvedValue(true)

      const res = await request(app)
        .post('/api/auth/interaction/test-uid/login')
        .send({ identifier: 'kid@example.com', password: 'hunter22', turnstileToken: 'tok-123' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.redirectTo).toBe('https://hub.labf.app/cb?code=abc')

      const { verifyTurnstileToken } = await import('../services/turnstile-service.js')
      expect(vi.mocked(verifyTurnstileToken)).toHaveBeenCalledWith('tok-123', expect.any(String))
      expect(provider.interactionResult).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { login: { accountId: '5' } },
        { mergeWithLastSubmission: false },
      )
    })

    it('rejects with 403 when turnstile verification fails', async () => {
      const { verifyTurnstileToken } = await import('../services/turnstile-service.js')
      vi.mocked(verifyTurnstileToken).mockResolvedValueOnce(false)

      const res = await request(app)
        .post('/api/auth/interaction/test-uid/login')
        .send({ identifier: 'kid@example.com', password: 'hunter22' })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ success: false, error: 'Bot verification failed' })
      expect(provider.interactionResult).not.toHaveBeenCalled()
    })

    it('rejects with 401 for wrong credentials', async () => {
      mockFindUserByEmail.mockResolvedValue(PASSWORD_USER)
      mockVerifyPassword.mockResolvedValue(false)

      const res = await request(app)
        .post('/api/auth/interaction/test-uid/login')
        .send({ identifier: 'kid@example.com', password: 'wrong', turnstileToken: 'tok' })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Invalid credentials')
    })

    it('rejects with 401 when the user is unknown', async () => {
      mockFindUserByEmail.mockResolvedValue(null)

      const res = await request(app)
        .post('/api/auth/interaction/test-uid/login')
        .send({ identifier: 'nobody@example.com', password: 'hunter22', turnstileToken: 'tok' })

      expect(res.status).toBe(401)
    })

    it('rejects with 400 when credentials are missing', async () => {
      const res = await request(app).post('/api/auth/interaction/test-uid/login').send({})

      expect(res.status).toBe(400)
    })

    it('allows login without an entitlement (apps gate in-app)', async () => {
      mockFindUserByEmail.mockResolvedValue(PASSWORD_USER)
      mockVerifyPassword.mockResolvedValue(true)

      const res = await request(app)
        .post('/api/auth/interaction/test-uid/login')
        .send({ identifier: 'kid@example.com', password: 'hunter22', turnstileToken: 'tok' })

      expect(res.status).toBe(200)
      expect(res.body.redirectTo).toBe('https://hub.labf.app/cb?code=abc')
    })
  })

  describe('POST /api/auth/interaction/:uid/google', () => {
    it('completes a Google login with turnstile verification', async () => {
      mockFindUserByGoogleId.mockResolvedValue(GOOGLE_USER)

      const res = await request(app)
        .post('/api/auth/interaction/test-uid/google')
        .send({ token: 'google-token', tokenType: 'id_token', turnstileToken: 'tok-456' })

      expect(res.status).toBe(200)
      expect(res.body.redirectTo).toBe('https://hub.labf.app/cb?code=abc')

      const { verifyTurnstileToken } = await import('../services/turnstile-service.js')
      expect(vi.mocked(verifyTurnstileToken)).toHaveBeenCalledWith('tok-456', expect.any(String))
    })

    it('rejects with 403 when turnstile verification fails', async () => {
      const { verifyTurnstileToken } = await import('../services/turnstile-service.js')
      vi.mocked(verifyTurnstileToken).mockResolvedValueOnce(false)

      const res = await request(app)
        .post('/api/auth/interaction/test-uid/google')
        .send({ token: 'google-token', tokenType: 'id_token' })

      expect(res.status).toBe(403)
    })

    it('returns 501 when Google is not configured', async () => {
      const { isGoogleConfigured } = await import('../services/google-auth-service.js')
      vi.mocked(isGoogleConfigured).mockReturnValueOnce(false)

      const res = await request(app)
        .post('/api/auth/interaction/test-uid/google')
        .send({ token: 'google-token' })

      expect(res.status).toBe(501)
    })

    it('rejects with 400 when the Google token is missing', async () => {
      const res = await request(app).post('/api/auth/interaction/test-uid/google').send({})

      expect(res.status).toBe(400)
    })

    it('rejects access_token type with 400 (only ID tokens accepted)', async () => {
      const res = await request(app)
        .post('/api/auth/interaction/test-uid/google')
        .send({ token: 'some-access-token', tokenType: 'access_token' })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Access tokens are not supported')
    })

    it('refuses account linking when the Google email is not verified', async () => {
      const sql = createSqlStub()
      const linkingApp = createTestApp(provider, sql)
      const { verifyGoogleToken } = await import('../services/google-auth-service.js')
      vi.mocked(verifyGoogleToken).mockResolvedValueOnce({
        googleId: 'g-new',
        email: 'kid@example.com',
        name: 'Kid',
        emailVerified: false,
      })
      mockFindUserByGoogleId.mockResolvedValue(null)
      mockFindUserByEmail.mockResolvedValue(PASSWORD_USER)

      const res = await request(linkingApp)
        .post('/api/auth/interaction/test-uid/google')
        .send({ token: 'id-token', tokenType: 'id_token' })

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('not verified')
      expect(sql).not.toHaveBeenCalled()
    })

    it('links the account when the Google email is verified', async () => {
      const sql = createSqlStub([GOOGLE_USER])
      const linkingApp = createTestApp(provider, sql)
      const { verifyGoogleToken } = await import('../services/google-auth-service.js')
      vi.mocked(verifyGoogleToken).mockResolvedValueOnce({
        googleId: 'g-new',
        email: 'kid@example.com',
        name: 'Kid',
        emailVerified: true,
      })
      mockFindUserByGoogleId.mockResolvedValue(null)
      mockFindUserByEmail.mockResolvedValue(PASSWORD_USER)

      const res = await request(linkingApp)
        .post('/api/auth/interaction/test-uid/google')
        .send({ token: 'id-token', tokenType: 'id_token' })

      expect(res.status).toBe(200)
      expect(res.body.redirectTo).toBe('https://hub.labf.app/cb?code=abc')
      expect(sql).toHaveBeenCalled()
    })
  })
})
