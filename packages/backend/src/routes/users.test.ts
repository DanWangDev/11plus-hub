import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { z } from 'zod'
import { createApp } from '../app.js'

vi.mock('../db/connection.js', () => ({
  checkDbConnection: vi.fn().mockResolvedValue(true),
  db: {},
}))

const { mockFindUserById, mockUpdateUser, mockListUsers, mockCountUsers } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockListUsers: vi.fn(),
  mockCountUsers: vi.fn(),
}))

vi.mock('../services/user-service.js', () => ({
  MIN_PASSWORD_LENGTH: 8,
  findUserById: (...args: unknown[]) => mockFindUserById(...args),
  updateUser: (...args: unknown[]) => mockUpdateUser(...args),
  listUsers: (...args: unknown[]) => mockListUsers(...args),
  countUsers: (...args: unknown[]) => mockCountUsers(...args),
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

describe('users routes', () => {
  const app = createApp({ skipDbCheck: true })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/users', () => {
    it('returns paginated list of users', async () => {
      const users = [
        {
          id: 1,
          username: 'user1',
          email: 'user1@example.com',
          display_name: 'User 1',
          role: 'student',
          parent_id: null,
          google_id: null,
          email_verified: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]
      mockListUsers.mockResolvedValueOnce(users)
      mockCountUsers.mockResolvedValueOnce(1)

      const res = await request(app).get('/api/users')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.meta).toMatchObject({
        total: 1,
        page: 1,
        limit: 20,
      })
    })

    it('passes pagination params', async () => {
      mockListUsers.mockResolvedValueOnce([])
      mockCountUsers.mockResolvedValueOnce(0)

      const res = await request(app).get('/api/users?page=2&limit=10')

      expect(res.status).toBe(200)
      expect(res.body.meta).toMatchObject({
        total: 0,
        page: 2,
        limit: 10,
      })
    })

    it('passes role filter', async () => {
      mockListUsers.mockResolvedValueOnce([])
      mockCountUsers.mockResolvedValueOnce(0)

      const res = await request(app).get('/api/users?role=admin')

      expect(res.status).toBe(200)
      expect(mockListUsers).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ role: 'admin' }),
      )
    })
  })

  describe('GET /api/users/:id', () => {
    it('returns user when found', async () => {
      mockFindUserById.mockResolvedValueOnce({
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        display_name: 'Test User',
        role: 'student',
        parent_id: null,
        google_id: null,
        email_verified: false,
        created_at: new Date(),
        updated_at: new Date(),
      })

      const res = await request(app).get('/api/users/1')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toMatchObject({
        id: 1,
        username: 'testuser',
      })
    })

    it('returns 404 when user not found', async () => {
      mockFindUserById.mockResolvedValueOnce(null)

      const res = await request(app).get('/api/users/999')

      expect(res.status).toBe(404)
      expect(res.body).toMatchObject({
        success: false,
        error: 'User not found',
      })
    })

    it('returns 400 for invalid ID', async () => {
      const res = await request(app).get('/api/users/abc')

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Invalid user ID',
      })
    })
  })

  describe('PATCH /api/users/:id', () => {
    it('updates user and returns 200', async () => {
      mockUpdateUser.mockResolvedValueOnce({
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        display_name: 'Updated Name',
        role: 'student',
        parent_id: null,
        google_id: null,
        email_verified: false,
        created_at: new Date(),
        updated_at: new Date(),
      })

      const res = await request(app).patch('/api/users/1').send({ displayName: 'Updated Name' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.display_name).toBe('Updated Name')
    })

    it('returns 400 for invalid data', async () => {
      const res = await request(app).patch('/api/users/1').send({ role: 'superadmin' })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Validation failed',
      })
    })

    it('returns 404 when user not found', async () => {
      mockUpdateUser.mockResolvedValueOnce(null)

      const res = await request(app).patch('/api/users/999').send({ displayName: 'New Name' })

      expect(res.status).toBe(404)
      expect(res.body).toMatchObject({
        success: false,
        error: 'User not found',
      })
    })

    it('returns 400 for invalid ID', async () => {
      const res = await request(app).patch('/api/users/abc').send({ displayName: 'New Name' })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Invalid user ID',
      })
    })
  })
})
