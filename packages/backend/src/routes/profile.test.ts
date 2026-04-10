import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { createProfileRouter } from './profile.js'

// Mock logger
vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Mock rate limiter (skip in tests)
vi.mock('../middleware/rate-limit.js', () => ({
  profileUpdateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// Mock iron-session
const mockSessionData: Record<string, unknown> = {}

vi.mock('iron-session', () => ({
  getIronSession: vi.fn(async () => ({
    ...mockSessionData,
    save: vi.fn(async () => {
      // Persist profileOverrides in mockSessionData
    }),
    destroy: vi.fn(),
  })),
}))

// Mock user service functions
const {
  mockFindUserById,
  mockFindUserWithPasswordHash,
  mockUpdateUser,
  mockVerifyPassword,
  mockUpdatePassword,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindUserWithPasswordHash: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockVerifyPassword: vi.fn(),
  mockUpdatePassword: vi.fn(),
}))

vi.mock('../services/user-service.js', () => ({
  MIN_PASSWORD_LENGTH: 8,
  findUserById: (...args: unknown[]) => mockFindUserById(...args),
  findUserWithPasswordHash: (...args: unknown[]) => mockFindUserWithPasswordHash(...args),
  updateUser: (...args: unknown[]) => mockUpdateUser(...args),
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
  updatePassword: (...args: unknown[]) => mockUpdatePassword(...args),
  hasPassword: vi.fn(),
  softDeleteUser: vi.fn(),
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserByUsername: vi.fn(),
  findUserByGoogleId: vi.fn(),
  listUsers: vi.fn(),
  countUsers: vi.fn(),
  createUserSchema: {},
  updateUserSchema: {},
  listUsersSchema: {},
}))

// Mock audit service
const { mockLogAction } = vi.hoisted(() => ({
  mockLogAction: vi.fn(),
}))

vi.mock('../services/audit-service.js', () => ({
  logAction: (...args: unknown[]) => mockLogAction(...args),
  AuditActions: {
    PROFILE_UPDATE: 'profile_update',
    PASSWORD_CHANGE: 'password_change',
  },
}))

const SESSION_SECRET = 'test-session-secret-minimum-32-characters-long!!'

const mockUser = {
  id: 42,
  username: 'testuser',
  email: 'test@example.com',
  display_name: 'Test User',
  role: 'student',
  parent_id: null,
  google_id: null,
  email_verified: true,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
}

function createTestApp() {
  const app = express()
  app.use(cookieParser())
  app.use(express.json())
  // Simulate requireAuth by setting res.locals.user
  app.use((req, res, next) => {
    res.locals.user = { sub: '42', username: 'testuser', role: 'student' }
    next()
  })
  app.use(createProfileRouter({ sql: {} as never, sessionSecret: SESSION_SECRET }))
  return app
}

describe('profile routes', () => {
  const app = createTestApp()

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(mockSessionData)) {
      delete mockSessionData[key]
    }
  })

  describe('PATCH /api/profile (display name)', () => {
    it('updates display name', async () => {
      mockUpdateUser.mockResolvedValueOnce({ ...mockUser, display_name: 'New Name' })
      mockFindUserById.mockResolvedValueOnce({ ...mockUser, display_name: 'New Name' })

      const res = await request(app)
        .patch('/api/profile')
        .send({ displayName: 'New Name' })
        .expect(200)

      expect(res.body.success).toBe(true)
      expect(mockUpdateUser).toHaveBeenCalledWith(expect.anything(), 42, {
        displayName: 'New Name',
      })
      expect(mockLogAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'profile_update',
          actorId: 42,
          targetId: 42,
        }),
      )
    })

    it('rejects empty body', async () => {
      const res = await request(app).patch('/api/profile').send({}).expect(400)

      expect(res.body.success).toBe(false)
      expect(res.body.error).toContain('Validation failed')
    })

    it('rejects invalid display name (too long)', async () => {
      const res = await request(app)
        .patch('/api/profile')
        .send({ displayName: 'a'.repeat(101) })
        .expect(400)

      expect(res.body.success).toBe(false)
      expect(res.body.error).toContain('Validation failed')
    })

    it('returns 401 when no auth user', async () => {
      const unauthApp = express()
      unauthApp.use(cookieParser())
      unauthApp.use(express.json())
      unauthApp.use(createProfileRouter({ sql: {} as never, sessionSecret: SESSION_SECRET }))

      const res = await request(unauthApp).patch('/api/profile').send({ displayName: 'Test' })

      expect(res.status).toBe(401)
    })
  })

  describe('PATCH /api/profile/password', () => {
    it('changes password with correct current password', async () => {
      mockFindUserWithPasswordHash.mockResolvedValueOnce({
        ...mockUser,
        password_hash: '$2b$12$fakehash',
      })
      mockVerifyPassword.mockResolvedValueOnce(true)
      mockUpdatePassword.mockResolvedValueOnce(undefined)

      const res = await request(app)
        .patch('/api/profile/password')
        .send({
          currentPassword: 'OldPassword1',
          newPassword: 'NewPassword1',
        })
        .expect(200)

      expect(res.body.success).toBe(true)
      expect(mockVerifyPassword).toHaveBeenCalledWith('OldPassword1', '$2b$12$fakehash')
      expect(mockUpdatePassword).toHaveBeenCalled()
      expect(mockLogAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'password_change' }),
      )
    })

    it('rejects missing current password', async () => {
      const res = await request(app)
        .patch('/api/profile/password')
        .send({ newPassword: 'NewPassword1' })
        .expect(400)

      expect(res.body.error).toContain('Validation failed')
    })

    it('rejects incorrect current password', async () => {
      mockFindUserWithPasswordHash.mockResolvedValueOnce({
        ...mockUser,
        password_hash: '$2b$12$fakehash',
      })
      mockVerifyPassword.mockResolvedValueOnce(false)

      const res = await request(app)
        .patch('/api/profile/password')
        .send({
          currentPassword: 'WrongPassword',
          newPassword: 'NewPassword1',
        })
        .expect(403)

      expect(res.body.error).toBe('Current password is incorrect')
    })

    it('rejects password change for Google-only account', async () => {
      mockFindUserWithPasswordHash.mockResolvedValueOnce({
        ...mockUser,
        password_hash: null,
      })

      const res = await request(app)
        .patch('/api/profile/password')
        .send({
          currentPassword: 'SomePassword',
          newPassword: 'NewPassword1',
        })
        .expect(400)

      expect(res.body.error).toContain('Google sign-in only')
    })

    it('rejects short new password', async () => {
      const res = await request(app)
        .patch('/api/profile/password')
        .send({
          currentPassword: 'OldPassword1',
          newPassword: 'short',
        })
        .expect(400)

      expect(res.body.error).toContain('Validation failed')
    })

    it('returns 401 when no auth user', async () => {
      const unauthApp = express()
      unauthApp.use(cookieParser())
      unauthApp.use(express.json())
      unauthApp.use(createProfileRouter({ sql: {} as never, sessionSecret: SESSION_SECRET }))

      const res = await request(unauthApp)
        .patch('/api/profile/password')
        .send({ currentPassword: 'Old1', newPassword: 'NewPassword1' })

      expect(res.status).toBe(401)
    })
  })
})
