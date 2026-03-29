import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { z } from 'zod'
import { createApp } from '../app.js'

vi.mock('../db/connection.js', () => ({
  checkDbConnection: vi.fn().mockResolvedValue(true),
  db: {},
}))

const { mockGetAuditLogs, mockCountAuditLogs, mockGetAuditLogById, mockGetActorHistory } =
  vi.hoisted(() => ({
    mockGetAuditLogs: vi.fn(),
    mockCountAuditLogs: vi.fn(),
    mockGetAuditLogById: vi.fn(),
    mockGetActorHistory: vi.fn(),
  }))

vi.mock('../services/audit-service.js', () => ({
  getAuditLogs: (...args: unknown[]) => mockGetAuditLogs(...args),
  countAuditLogs: (...args: unknown[]) => mockCountAuditLogs(...args),
  getAuditLogById: (...args: unknown[]) => mockGetAuditLogById(...args),
  getActorHistory: (...args: unknown[]) => mockGetActorHistory(...args),
  logAction: vi.fn(),
  listAuditLogsSchema: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
    actorId: z.coerce.number().int().positive().optional(),
    action: z.string().optional(),
    targetId: z.coerce.number().int().positive().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  }),
  logActionSchema: z.object({
    actorId: z.number().int().positive().nullable().optional(),
    action: z.string().min(1).max(100),
    targetId: z.number().int().positive().optional(),
    details: z.record(z.unknown()).default({}),
    ipAddress: z.string().optional(),
  }),
  AuditActions: {
    LOGIN: 'login',
    LOGIN_FAILED: 'login_failed',
    REGISTER: 'register',
    LOGOUT: 'logout',
    PASSWORD_RESET_REQUEST: 'password_reset_request',
    PASSWORD_RESET_COMPLETE: 'password_reset_complete',
    USER_UPDATE: 'user_update',
    USER_DELETE: 'user_delete',
    SUBSCRIPTION_CREATE: 'subscription_create',
    SUBSCRIPTION_UPDATE: 'subscription_update',
    SUBSCRIPTION_CANCEL: 'subscription_cancel',
    APP_ACCESS_GRANT: 'app_access_grant',
    APP_ACCESS_REVOKE: 'app_access_revoke',
    APP_REGISTER: 'app_register',
    APP_UPDATE: 'app_update',
    PROFILE_UPDATE: 'profile_update',
    PASSWORD_CHANGE: 'password_change',
    IMPERSONATE_START: 'impersonate_start',
    IMPERSONATE_END: 'impersonate_end',
  },
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

const sampleAuditLog = {
  id: 1,
  actor_id: 42,
  action: 'login',
  target_id: null,
  details: {},
  ip_address: '127.0.0.1',
  created_at: new Date('2025-01-01T00:00:00Z'),
}

describe('audit routes', () => {
  const app = createApp({ skipDbCheck: true })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/audit', () => {
    it('returns paginated list of audit logs', async () => {
      mockGetAuditLogs.mockResolvedValueOnce([sampleAuditLog])
      mockCountAuditLogs.mockResolvedValueOnce(1)

      const res = await request(app).get('/api/audit')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.meta).toMatchObject({
        total: 1,
        page: 1,
        limit: 50,
      })
    })

    it('passes filter params', async () => {
      mockGetAuditLogs.mockResolvedValueOnce([])
      mockCountAuditLogs.mockResolvedValueOnce(0)

      const res = await request(app).get('/api/audit?action=login&page=2&limit=10')

      expect(res.status).toBe(200)
      expect(res.body.meta).toMatchObject({
        total: 0,
        page: 2,
        limit: 10,
      })
    })

    it('passes actorId filter', async () => {
      mockGetAuditLogs.mockResolvedValueOnce([sampleAuditLog])
      mockCountAuditLogs.mockResolvedValueOnce(1)

      const res = await request(app).get('/api/audit?actorId=42')

      expect(res.status).toBe(200)
      expect(mockGetAuditLogs).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorId: 42 }),
      )
    })

    it('returns 400 for invalid query params', async () => {
      const res = await request(app).get('/api/audit?limit=999')

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Validation failed',
      })
    })
  })

  describe('GET /api/audit/:id', () => {
    it('returns audit log entry when found', async () => {
      mockGetAuditLogById.mockResolvedValueOnce(sampleAuditLog)

      const res = await request(app).get('/api/audit/1')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toMatchObject({
        id: 1,
        action: 'login',
      })
    })

    it('returns 404 when not found', async () => {
      mockGetAuditLogById.mockResolvedValueOnce(null)

      const res = await request(app).get('/api/audit/999')

      expect(res.status).toBe(404)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Audit log entry not found',
      })
    })

    it('returns 400 for invalid ID', async () => {
      const res = await request(app).get('/api/audit/abc')

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Invalid audit log ID',
      })
    })
  })

  describe('GET /api/audit/actor/:actorId', () => {
    it('returns actor history', async () => {
      mockGetActorHistory.mockResolvedValueOnce([sampleAuditLog])

      const res = await request(app).get('/api/audit/actor/42')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.meta).toMatchObject({
        page: 1,
        limit: 50,
      })
    })

    it('returns empty list for actor with no history', async () => {
      mockGetActorHistory.mockResolvedValueOnce([])

      const res = await request(app).get('/api/audit/actor/999')

      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(0)
    })

    it('returns 400 for invalid actor ID', async () => {
      const res = await request(app).get('/api/audit/actor/abc')

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Invalid actor ID',
      })
    })

    it('passes pagination params to actor history', async () => {
      mockGetActorHistory.mockResolvedValueOnce([])

      const res = await request(app).get('/api/audit/actor/42?page=2&limit=10')

      expect(res.status).toBe(200)
      expect(res.body.meta).toMatchObject({
        page: 2,
        limit: 10,
      })
    })
  })
})
