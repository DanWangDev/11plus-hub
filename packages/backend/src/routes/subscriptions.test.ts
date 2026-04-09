import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { z } from 'zod'
import { createApp } from '../app.js'

vi.mock('../db/connection.js', () => ({
  checkDbConnection: vi.fn().mockResolvedValue(true),
  db: {},
}))

const mockCreateSubscription = vi.fn()
const mockFindSubscriptionById = vi.fn()
const mockUpdateSubscription = vi.fn()
const mockCancelSubscription = vi.fn()
const mockListSubscriptions = vi.fn()
const mockCountSubscriptions = vi.fn()
const mockGetUserAppAccess = vi.fn()
const mockGrantAppAccess = vi.fn()
const mockRevokeAppAccess = vi.fn()
const mockCheckEntitlement = vi.fn()

vi.mock('../services/subscription-service.js', () => ({
  createSubscription: (...args: unknown[]) => mockCreateSubscription(...args),
  findSubscriptionById: (...args: unknown[]) => mockFindSubscriptionById(...args),
  findSubscriptionByUserId: vi.fn(),
  updateSubscription: (...args: unknown[]) => mockUpdateSubscription(...args),
  cancelSubscription: (...args: unknown[]) => mockCancelSubscription(...args),
  listSubscriptions: (...args: unknown[]) => mockListSubscriptions(...args),
  countSubscriptions: (...args: unknown[]) => mockCountSubscriptions(...args),
  getFeatures: vi.fn(),
  getUserAppAccess: (...args: unknown[]) => mockGetUserAppAccess(...args),
  grantAppAccess: (...args: unknown[]) => mockGrantAppAccess(...args),
  revokeAppAccess: (...args: unknown[]) => mockRevokeAppAccess(...args),
  syncAppAccessFromPlan: vi.fn(),
  checkEntitlement: (...args: unknown[]) => mockCheckEntitlement(...args),
  createSubscriptionSchema: z.object({
    userId: z.number().int().positive(),
    plan: z.enum(['free', 'writing', 'vocab', 'bundle', 'family']).default('free'),
    status: z.enum(['active', 'trial', 'expired', 'cancelled']).default('active'),
    features: z.array(z.string()).optional(),
    expiresAt: z.string().datetime().optional(),
    assignedBy: z.number().int().positive().optional(),
  }),
  updateSubscriptionSchema: z.object({
    plan: z.enum(['free', 'writing', 'vocab', 'bundle', 'family']).optional(),
    status: z.enum(['active', 'trial', 'expired', 'cancelled']).optional(),
    features: z.array(z.string()).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  }),
  listSubscriptionsSchema: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    plan: z.enum(['free', 'writing', 'vocab', 'bundle', 'family']).optional(),
    status: z.enum(['active', 'trial', 'expired', 'cancelled']).optional(),
    userId: z.coerce.number().int().positive().optional(),
  }),
}))

vi.mock('../services/user-service.js', () => ({
  MIN_PASSWORD_LENGTH: 8,
  findUserById: vi.fn(),
  updateUser: vi.fn(),
  listUsers: vi.fn(),
  countUsers: vi.fn(),
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserByUsername: vi.fn(),
  findUserByGoogleId: vi.fn(),
  findUserWithPasswordHash: vi.fn(),
  verifyPassword: vi.fn(),
  hasPassword: vi.fn(),
  updatePassword: vi.fn(),
  listUsersSchema: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    role: z.enum(['student', 'parent', 'admin']).optional(),
    search: z.string().optional(),
  }),
  updateUserSchema: z.object({
    displayName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    role: z.enum(['student', 'parent', 'admin']).optional(),
    parentId: z.number().int().positive().nullable().optional(),
  }),
  createUserSchema: z.object({
    username: z
      .string()
      .min(3)
      .max(30)
      .regex(/^[a-zA-Z0-9_-]+$/),
    email: z.string().email(),
    password: z.string().min(8).optional(),
    displayName: z.string().min(1).max(100),
    role: z.enum(['student', 'parent', 'admin']).default('student'),
    parentId: z.number().int().positive().optional(),
    googleId: z.string().optional(),
  }),
}))

vi.mock('../services/app-service.js', () => ({
  createApplication: vi.fn(),
  findApplicationById: vi.fn(),
  updateApplication: vi.fn(),
  listApplications: vi.fn(),
  countApplications: vi.fn(),
  createServiceToken: vi.fn(),
  revokeServiceToken: vi.fn(),
  createAppSchema: z.object({}),
  updateAppSchema: z.object({}),
}))

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const sampleSubscription = {
  id: 1,
  user_id: 10,
  plan: 'bundle',
  status: 'active',
  features: ['writing', 'vocab'],
  expires_at: null,
  assigned_by: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
}

describe('subscription routes', () => {
  const app = createApp({ skipDbCheck: true })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/subscriptions', () => {
    it('creates a subscription (201)', async () => {
      mockCreateSubscription.mockResolvedValue(sampleSubscription)

      const res = await request(app).post('/api/subscriptions').send({ userId: 10, plan: 'bundle' })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toMatchObject({
        id: 1,
        user_id: 10,
        plan: 'bundle',
      })
    })

    it('returns 400 for invalid data', async () => {
      const res = await request(app)
        .post('/api/subscriptions')
        .send({ userId: -1, plan: 'premium' })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Validation failed',
      })
    })

    it('returns 400 when userId is missing', async () => {
      const res = await request(app).post('/api/subscriptions').send({ plan: 'bundle' })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })

  describe('GET /api/subscriptions', () => {
    it('returns paginated list', async () => {
      mockListSubscriptions.mockResolvedValue([sampleSubscription])
      mockCountSubscriptions.mockResolvedValue(1)

      const res = await request(app).get('/api/subscriptions')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.meta).toMatchObject({ total: 1, page: 1, limit: 20 })
    })

    it('passes plan filter', async () => {
      mockListSubscriptions.mockResolvedValue([])
      mockCountSubscriptions.mockResolvedValue(0)

      const res = await request(app).get('/api/subscriptions?plan=writing')

      expect(res.status).toBe(200)
      expect(mockListSubscriptions).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ plan: 'writing' }),
      )
    })

    it('passes status filter', async () => {
      mockListSubscriptions.mockResolvedValue([])
      mockCountSubscriptions.mockResolvedValue(0)

      const res = await request(app).get('/api/subscriptions?status=active')

      expect(res.status).toBe(200)
      expect(mockListSubscriptions).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'active' }),
      )
    })
  })

  describe('GET /api/subscriptions/:id', () => {
    it('returns subscription when found (200)', async () => {
      mockFindSubscriptionById.mockResolvedValue(sampleSubscription)

      const res = await request(app).get('/api/subscriptions/1')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toMatchObject({ id: 1, plan: 'bundle' })
    })

    it('returns 404 when not found', async () => {
      mockFindSubscriptionById.mockResolvedValue(null)

      const res = await request(app).get('/api/subscriptions/999')

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })

    it('returns 400 for invalid ID', async () => {
      const res = await request(app).get('/api/subscriptions/abc')

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })

  describe('PATCH /api/subscriptions/:id', () => {
    it('updates subscription', async () => {
      const updated = { ...sampleSubscription, plan: 'writing' }
      mockUpdateSubscription.mockResolvedValue(updated)

      const res = await request(app).patch('/api/subscriptions/1').send({ plan: 'writing' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.plan).toBe('writing')
    })

    it('returns 404 when not found', async () => {
      mockUpdateSubscription.mockResolvedValue(null)

      const res = await request(app).patch('/api/subscriptions/999').send({ plan: 'writing' })

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })

    it('returns 400 for invalid data', async () => {
      const res = await request(app).patch('/api/subscriptions/1').send({ plan: 'premium' })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Validation failed',
      })
    })
  })

  describe('DELETE /api/subscriptions/:id', () => {
    it('cancels subscription', async () => {
      const cancelled = { ...sampleSubscription, status: 'cancelled' }
      mockCancelSubscription.mockResolvedValue(cancelled)

      const res = await request(app).delete('/api/subscriptions/1')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.status).toBe('cancelled')
    })

    it('returns 404 when not found', async () => {
      mockCancelSubscription.mockResolvedValue(null)

      const res = await request(app).delete('/api/subscriptions/999')

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })
  })

  describe('GET /api/users/:userId/entitlements', () => {
    it('returns app access list', async () => {
      const entries = [
        { user_id: 10, app_id: 1, granted_at: new Date() },
        { user_id: 10, app_id: 2, granted_at: new Date() },
      ]
      mockGetUserAppAccess.mockResolvedValue(entries)

      const res = await request(app).get('/api/users/10/entitlements')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveLength(2)
    })

    it('returns 400 for invalid user ID', async () => {
      const res = await request(app).get('/api/users/abc/entitlements')

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })

  describe('POST /api/users/:userId/entitlements/:appId', () => {
    it('grants app access (201)', async () => {
      const access = { user_id: 10, app_id: 1, granted_at: new Date() }
      mockGrantAppAccess.mockResolvedValue(access)

      const res = await request(app).post('/api/users/10/entitlements/1')

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toMatchObject({ user_id: 10, app_id: 1 })
    })

    it('returns 400 for invalid user ID', async () => {
      const res = await request(app).post('/api/users/abc/entitlements/1')

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('returns 400 for invalid app ID', async () => {
      const res = await request(app).post('/api/users/10/entitlements/abc')

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })

  describe('DELETE /api/users/:userId/entitlements/:appId', () => {
    it('revokes app access', async () => {
      mockRevokeAppAccess.mockResolvedValue(true)

      const res = await request(app).delete('/api/users/10/entitlements/1')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.revoked).toBe(true)
    })

    it('returns 404 when access not found', async () => {
      mockRevokeAppAccess.mockResolvedValue(false)

      const res = await request(app).delete('/api/users/10/entitlements/999')

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })
  })

  describe('GET /api/users/:userId/entitlements/:appSlug/check', () => {
    it('returns 200 when user is entitled', async () => {
      mockCheckEntitlement.mockResolvedValue(true)

      const res = await request(app).get('/api/users/10/entitlements/writing-buddy/check')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.entitled).toBe(true)
    })

    it('returns 403 when user is not entitled', async () => {
      mockCheckEntitlement.mockResolvedValue(false)

      const res = await request(app).get('/api/users/10/entitlements/writing-buddy/check')

      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('User does not have access to this application')
    })

    it('returns 400 for invalid user ID', async () => {
      const res = await request(app).get('/api/users/abc/entitlements/writing-buddy/check')

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })
})
