import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { z } from 'zod'
import { createApp } from '../app.js'

vi.mock('../db/connection.js', () => ({
  checkDbConnection: vi.fn().mockResolvedValue(true),
  db: {},
}))

const mockFindUserByEmail = vi.fn()
const mockCreateResetToken = vi.fn()
const mockResetPassword = vi.fn()

vi.mock('../services/user-service.js', () => ({
  findUserById: vi.fn(),
  findUserByEmail: (...args: unknown[]) => mockFindUserByEmail(...args),
  updateUser: vi.fn(),
  listUsers: vi.fn(),
  countUsers: vi.fn(),
  createUser: vi.fn(),
  findUserByUsername: vi.fn(),
  findUserByGoogleId: vi.fn(),
  verifyPassword: vi.fn(),
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

vi.mock('../services/password-reset-service.js', () => ({
  createResetToken: (...args: unknown[]) => mockCreateResetToken(...args),
  resetPassword: (...args: unknown[]) => mockResetPassword(...args),
  requestResetSchema: z.object({
    email: z.string().email(),
  }),
  resetPasswordSchema: z.object({
    selector: z.string().min(1),
    validator: z.string().min(1),
    newPassword: z.string().min(8),
  }),
}))

vi.mock('../services/audit-service.js', () => ({
  logAction: vi.fn().mockResolvedValue({}),
  AuditActions: {
    PASSWORD_RESET_REQUEST: 'password_reset_request',
    PASSWORD_RESET_COMPLETE: 'password_reset_complete',
  },
}))

vi.mock('../services/subscription-service.js', () => ({
  createSubscription: vi.fn(),
  findSubscriptionById: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  updateSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  listSubscriptions: vi.fn(),
  countSubscriptions: vi.fn(),
  getFeatures: vi.fn(),
  getUserAppAccess: vi.fn(),
  grantAppAccess: vi.fn(),
  revokeAppAccess: vi.fn(),
  syncAppAccessFromPlan: vi.fn(),
  checkEntitlement: vi.fn(),
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

describe('password reset routes', () => {
  const app = createApp({ skipDbCheck: true })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/auth/forgot-password', () => {
    it('returns success even for unknown email (prevents enumeration)', async () => {
      mockFindUserByEmail.mockResolvedValue(null)

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'unknown@example.com' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('creates reset token for known user', async () => {
      mockFindUserByEmail.mockResolvedValue({
        id: 42,
        email: 'user@example.com',
        password_hash: '$2b$12$hash',
      })
      mockCreateResetToken.mockResolvedValue({
        selector: 'sel123',
        validator: 'val456',
      })

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'user@example.com' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockCreateResetToken).toHaveBeenCalledWith(expect.anything(), 42)
    })

    it('returns 400 for invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'not-an-email' })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })

  describe('POST /api/auth/reset-password', () => {
    it('resets password successfully', async () => {
      mockResetPassword.mockResolvedValue(true)

      const res = await request(app).post('/api/auth/reset-password').send({
        selector: 'sel123',
        validator: 'val456',
        newPassword: 'newstrongpassword',
      })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('returns 400 for invalid/expired token', async () => {
      mockResetPassword.mockResolvedValue(false)

      const res = await request(app).post('/api/auth/reset-password').send({
        selector: 'expired',
        validator: 'invalid',
        newPassword: 'newstrongpassword',
      })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Invalid or expired reset token')
    })

    it('returns 400 for short password', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({
        selector: 'sel123',
        validator: 'val456',
        newPassword: 'short',
      })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('returns 400 for missing selector', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({
        validator: 'val456',
        newPassword: 'longpassword123',
      })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })
})
