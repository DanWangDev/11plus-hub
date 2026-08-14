import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import type postgres from 'postgres'
import type { Request, Response, NextFunction } from 'express'
import { createImpersonateRouter, blockWriteDuringImpersonation } from './impersonate.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const {
  mockFindUserById,
  mockHasPassword,
  mockFindSubscriptionByUserId,
  mockGetUserAppAccess,
  mockSyncAppAccessFromPlan,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockHasPassword: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockGetUserAppAccess: vi.fn(),
  mockSyncAppAccessFromPlan: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/user-service.js', () => ({
  findUserById: (...args: unknown[]) => mockFindUserById(...args),
  hasPassword: (...args: unknown[]) => mockHasPassword(...args),
}))

vi.mock('../services/subscription-service.js', () => ({
  findSubscriptionByUserId: (...args: unknown[]) => mockFindSubscriptionByUserId(...args),
  getUserAppAccess: (...args: unknown[]) => mockGetUserAppAccess(...args),
  syncAppAccessFromPlan: (...args: unknown[]) => mockSyncAppAccessFromPlan(...args),
  PLAN_APP_SLUGS: {
    free: [],
    writing: ['writing-buddy'],
    vocab: ['vocab-master'],
    bundle: ['writing-buddy', 'vocab-master', 'story-sleuth'],
    family: ['writing-buddy', 'vocab-master', 'story-sleuth'],
  },
}))

vi.mock('../services/audit-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/audit-service.js')>()
  return { ...actual, logAction: vi.fn().mockResolvedValue(undefined) }
})

const mockSession: Record<string, unknown> & { save?: () => Promise<void> } = {}
vi.mock('iron-session', () => ({
  getIronSession: vi.fn(async () => mockSession),
}))

const TARGET_USER = {
  id: 5,
  username: 'emma',
  email: 'emma@example.com',
  display_name: 'Emma Wang',
  role: 'student',
  parent_id: null,
  google_id: null,
  email_verified: false,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  last_active_at: null,
}

function createApp(
  sql: postgres.Sql,
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void = (_req, _res, next) =>
    next(),
) {
  const app = express()
  app.use(express.json())
  app.use(
    createImpersonateRouter({
      sql,
      sessionSecret: 'test-session-secret-at-least-32-chars-long!!',
      requireAuth: (req, res, next) => {
        res.locals.user = { sub: '1', username: 'admin1', role: 'admin' }
        next()
      },
      requireAdmin,
    }),
  )
  return app
}

function createSqlStub(slugRows: Array<{ slug: string }> = []) {
  return vi.fn().mockResolvedValue(slugRows) as unknown as postgres.Sql
}

describe('createImpersonateRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSession).forEach((k) => delete mockSession[k])
    mockSession.save = vi.fn().mockResolvedValue(undefined)
  })

  describe('POST /api/admin/impersonate', () => {
    it('starts impersonation and logs it', async () => {
      mockFindUserById.mockResolvedValue(TARGET_USER)
      mockFindSubscriptionByUserId.mockResolvedValue({
        plan: 'vocab',
        features: ['vocab'],
        expires_at: null,
      })
      mockGetUserAppAccess.mockResolvedValue([{ app_id: 1 }])
      mockHasPassword.mockResolvedValue(true)
      const sql = createSqlStub([{ slug: 'vocab-master' }])
      const app = createApp(sql)

      const res = await request(app).post('/api/admin/impersonate').send({ userId: 5 })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.username).toBe('emma')
      expect(res.body.data.role).toBe('student')
      expect(res.body.data.impersonatedBy.adminUserId).toBe(1)
      expect(mockSession.impersonation).toBeDefined()
      expect(mockSession.save).toHaveBeenCalled()

      const audit = await import('../services/audit-service.js')
      expect(vi.mocked(audit.logAction)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'impersonate_start', targetId: 5 }),
      )
    })

    it('auto-syncs stale app access before impersonating', async () => {
      mockFindUserById.mockResolvedValue(TARGET_USER)
      mockFindSubscriptionByUserId.mockResolvedValue({
        plan: 'bundle',
        features: [],
        expires_at: null,
      })
      mockGetUserAppAccess.mockResolvedValue([{ app_id: 1 }])
      mockHasPassword.mockResolvedValue(true)
      // Registry returns only vocab-master, but the bundle plan expects 3 apps
      const sql = createSqlStub([{ slug: 'vocab-master' }])
      const app = createApp(sql)

      const res = await request(app).post('/api/admin/impersonate').send({ userId: 5 })

      expect(res.status).toBe(200)
      expect(mockSyncAppAccessFromPlan).toHaveBeenCalledWith(expect.anything(), 5, 'bundle')
    })

    it('rejects a missing or invalid userId', async () => {
      const app = createApp(createSqlStub())

      const res = await request(app).post('/api/admin/impersonate').send({ userId: 'abc' })

      expect(res.status).toBe(400)
    })

    it('returns 404 for an unknown target', async () => {
      mockFindUserById.mockResolvedValue(null)
      const app = createApp(createSqlStub())

      const res = await request(app).post('/api/admin/impersonate').send({ userId: 999 })

      expect(res.status).toBe(404)
    })

    it('refuses to impersonate yourself', async () => {
      mockFindUserById.mockResolvedValue({ ...TARGET_USER, id: 1 })
      const app = createApp(createSqlStub())

      const res = await request(app).post('/api/admin/impersonate').send({ userId: 1 })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Cannot impersonate yourself')
    })

    it('enforces the admin role', async () => {
      const denyAdmin = (_req: Request, res: Response, _next: NextFunction) => {
        res.status(403).json({ success: false, error: 'Admin access required' })
      }
      const app = createApp(createSqlStub(), denyAdmin)

      const res = await request(app).post('/api/admin/impersonate').send({ userId: 5 })

      expect(res.status).toBe(403)
    })
  })

  describe('POST /api/admin/impersonate/end', () => {
    it('ends impersonation and logs it', async () => {
      mockSession.impersonation = {
        targetUserId: 5,
        claims: { sub: '5' },
        impersonatedBy: {
          adminUserId: 1,
          adminUsername: 'admin1',
          startedAt: new Date().toISOString(),
        },
      }
      const app = createApp(createSqlStub())

      const res = await request(app).post('/api/admin/impersonate/end')

      expect(res.status).toBe(200)
      expect(mockSession.impersonation).toBeUndefined()
      expect(mockSession.save).toHaveBeenCalled()

      const audit = await import('../services/audit-service.js')
      expect(vi.mocked(audit.logAction)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'impersonate_end', targetId: 5 }),
      )
    })

    it('returns 400 when not currently impersonating', async () => {
      const app = createApp(createSqlStub())

      const res = await request(app).post('/api/admin/impersonate/end')

      expect(res.status).toBe(400)
    })
  })
})

describe('blockWriteDuringImpersonation', () => {
  function mockReqRes(method: string, path: string, user?: Record<string, unknown>) {
    const req = {
      method,
      path,
    } as Request
    const res = {
      locals: { user: user ?? null },
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response
    const next = vi.fn() as NextFunction
    return { req, res, next }
  }

  it('calls next when not impersonating', () => {
    const { req, res, next } = mockReqRes('POST', '/api/users', {})
    blockWriteDuringImpersonation(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('calls next for GET requests during impersonation', () => {
    const { req, res, next } = mockReqRes('GET', '/api/users', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('blocks POST requests during impersonation', () => {
    const { req, res, next } = mockReqRes('POST', '/api/users', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Read-only') }),
    )
  })

  it('blocks PATCH requests during impersonation', () => {
    const { req, res, next } = mockReqRes('PATCH', '/api/users/1', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('blocks DELETE requests during impersonation', () => {
    const { req, res, next } = mockReqRes('DELETE', '/api/users/1', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('allows HEAD requests during impersonation', () => {
    const { req, res, next } = mockReqRes('HEAD', '/api/apps', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('allows OPTIONS requests during impersonation', () => {
    const { req, res, next } = mockReqRes('OPTIONS', '/api/apps', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('allows POST to impersonate end during impersonation', () => {
    const { req, res, next } = mockReqRes('POST', '/api/admin/impersonate/end', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(next).toHaveBeenCalled()
  })
})
