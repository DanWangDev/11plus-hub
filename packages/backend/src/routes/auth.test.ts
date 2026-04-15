import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { z } from 'zod'
import { createApp } from '../app.js'

vi.mock('../db/connection.js', () => ({
  checkDbConnection: vi.fn().mockResolvedValue(true),
  db: {},
}))

const { mockCreateUser, mockFindUserByEmail, mockVerifyPassword, mockUpdateLastActive } =
  vi.hoisted(() => ({
    mockCreateUser: vi.fn(),
    mockFindUserByEmail: vi.fn(),
    mockVerifyPassword: vi.fn(),
    mockUpdateLastActive: vi.fn().mockResolvedValue(undefined),
  }))

vi.mock('../services/user-service.js', () => ({
  createUser: (...args: unknown[]) => mockCreateUser(...args),
  findUserByEmail: (...args: unknown[]) => mockFindUserByEmail(...args),
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
  updateLastActive: (...args: unknown[]) => mockUpdateLastActive(...args),
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
  findUserByUsername: vi.fn(),
  findUserByGoogleId: vi.fn(),
  findUserWithPasswordHash: vi.fn(),
  generateUniqueUsername: vi.fn(),
  updateUser: vi.fn(),
  listUsers: vi.fn(),
  countUsers: vi.fn(),
  hasPassword: vi.fn(),
  updatePassword: vi.fn(),
  MIN_PASSWORD_LENGTH: 8,
  updateUserSchema: z.object({}),
  listUsersSchema: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    role: z.enum(['student', 'parent', 'admin']).optional(),
    search: z.string().optional(),
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

vi.mock('../services/google-auth-service.js', () => ({
  verifyGoogleToken: vi.fn(),
  isGoogleConfigured: vi.fn().mockReturnValue(false),
}))

vi.mock('../services/turnstile-service.js', () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue(true),
}))

describe('auth routes', () => {
  const app = createApp({ skipDbCheck: true })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/auth/register', () => {
    const validBody = {
      username: 'newuser',
      email: 'new@example.com',
      password: 'securepass123',
      displayName: 'New User',
    }

    it('creates a user and returns 201', async () => {
      mockCreateUser.mockResolvedValueOnce({
        id: 1,
        username: 'newuser',
        email: 'new@example.com',
        display_name: 'New User',
        role: 'student',
        parent_id: null,
        google_id: null,
        email_verified: false,
        created_at: new Date(),
        updated_at: new Date(),
      })

      const res = await request(app).post('/api/auth/register').send(validBody)

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toMatchObject({
        id: 1,
        username: 'newuser',
        email: 'new@example.com',
      })
      expect(res.body.data).not.toHaveProperty('password_hash')
    })

    it('returns 409 for duplicate email', async () => {
      mockCreateUser.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      )

      const res = await request(app).post('/api/auth/register').send(validBody)

      expect(res.status).toBe(409)
      expect(res.body).toMatchObject({
        success: false,
        error: 'User already exists',
      })
    })

    it('returns 400 for invalid data', async () => {
      const res = await request(app).post('/api/auth/register').send({ email: 'not-valid' })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Validation failed',
      })
    })

    it('returns 400 for short password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...validBody, password: 'short' })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })

  describe('POST /api/auth/login', () => {
    it('returns user and token for correct credentials', async () => {
      mockFindUserByEmail.mockResolvedValueOnce({
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        password_hash: '$2b$12$hash',
        display_name: 'Test User',
        role: 'student',
        parent_id: null,
        google_id: null,
        email_verified: false,
        created_at: new Date(),
        updated_at: new Date(),
      })
      mockVerifyPassword.mockResolvedValueOnce(true)

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'securepass123' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toMatchObject({
        id: 1,
        email: 'test@example.com',
      })
      expect(res.body.data.user).not.toHaveProperty('password_hash')
      expect(res.body.data.token).toBe('placeholder-jwt-token')
      // Successful login must bump last_active_at for admin visibility
      expect(mockUpdateLastActive).toHaveBeenCalledWith(expect.anything(), 1)
    })

    it('does not bump last_active_at on failed login', async () => {
      mockUpdateLastActive.mockClear()
      mockFindUserByEmail.mockResolvedValueOnce({
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        password_hash: '$2b$12$hash',
        display_name: 'Test User',
        role: 'student',
        parent_id: null,
        google_id: null,
        email_verified: false,
        created_at: new Date(),
        updated_at: new Date(),
      })
      mockVerifyPassword.mockResolvedValueOnce(false)

      await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrongpass' })

      expect(mockUpdateLastActive).not.toHaveBeenCalled()
    })

    it('returns 401 for wrong password', async () => {
      mockFindUserByEmail.mockResolvedValueOnce({
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        password_hash: '$2b$12$hash',
        display_name: 'Test User',
        role: 'student',
        parent_id: null,
        google_id: null,
        email_verified: false,
        created_at: new Date(),
        updated_at: new Date(),
      })
      mockVerifyPassword.mockResolvedValueOnce(false)

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrongpass' })

      expect(res.status).toBe(401)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Invalid credentials',
      })
    })

    it('returns 401 for nonexistent user', async () => {
      mockFindUserByEmail.mockResolvedValueOnce(null)

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'somepass' })

      expect(res.status).toBe(401)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Invalid credentials',
      })
    })

    it('returns 400 when email is missing', async () => {
      const res = await request(app).post('/api/auth/login').send({ password: 'somepass' })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Email or username, and password are required',
      })
    })

    it('returns 400 when password is missing', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'test@example.com' })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Email or username, and password are required',
      })
    })
  })
})
