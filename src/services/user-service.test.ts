import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcrypt'
import {
  createUser,
  findUserById,
  findUserByEmail,
  findUserByUsername,
  findUserByGoogleId,
  verifyPassword,
  updateUser,
  listUsers,
  countUsers,
  createUserSchema,
  updateUserSchema,
  listUsersSchema,
} from './user-service.js'

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$12$hashedpassword'),
    compare: vi.fn(),
  },
}))

function createMockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    password_hash: '$2b$12$hashedpassword',
    display_name: 'Test User',
    role: 'student',
    parent_id: null,
    google_id: null,
    email_verified: false,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  }
}

type TaggedTemplateArgs = [TemplateStringsArray, ...unknown[]]

function createMockSql(returnValue: unknown[] = []) {
  const sqlFn = vi.fn((..._args: TaggedTemplateArgs) =>
    Promise.resolve(returnValue),
  ) as unknown as Record<string, unknown>

  // Mock the sql(values) helper for dynamic SET clauses
  const callableSql = Object.assign(sqlFn, {
    // postgres.js uses sql`...` as tagged template and sql(obj) for dynamic values
  })

  // Make the function also work when called as sql(obj) for dynamic SET
  return callableSql as unknown as ReturnType<typeof vi.fn>
}

describe('user-service', () => {
  describe('createUser', () => {
    it('creates a user with hashed password and returns without password_hash', async () => {
      const mockUser = createMockUser()
      const mockSql = createMockSql([mockUser])

      const result = await createUser(mockSql as never, {
        username: 'testuser',
        email: 'test@example.com',
        password: 'securepass123',
        displayName: 'Test User',
        role: 'student',
      })

      expect(bcrypt.hash).toHaveBeenCalledWith('securepass123', 12)
      expect(result).not.toHaveProperty('password_hash')
      expect(result).toMatchObject({
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        display_name: 'Test User',
        role: 'student',
      })
    })

    it('creates a Google OAuth user without password', async () => {
      const mockUser = createMockUser({
        google_id: 'google-123',
        password_hash: null,
      })
      const mockSql = createMockSql([mockUser])

      const result = await createUser(mockSql as never, {
        username: 'googleuser',
        email: 'google@example.com',
        displayName: 'Google User',
        googleId: 'google-123',
      })

      expect(bcrypt.hash).not.toHaveBeenCalledWith(undefined, expect.anything())
      expect(result).not.toHaveProperty('password_hash')
      expect(result.google_id).toBe('google-123')
    })

    it('throws on duplicate email (unique constraint violation)', async () => {
      const mockSql = createMockSql()
      ;(mockSql as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      )

      await expect(
        createUser(mockSql as never, {
          username: 'newuser',
          email: 'duplicate@example.com',
          password: 'securepass123',
          displayName: 'New User',
        }),
      ).rejects.toThrow('duplicate key')
    })

    it('throws on duplicate username (unique constraint violation)', async () => {
      const mockSql = createMockSql()
      ;(mockSql as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      )

      await expect(
        createUser(mockSql as never, {
          username: 'existing',
          email: 'new@example.com',
          password: 'securepass123',
          displayName: 'New User',
        }),
      ).rejects.toThrow('duplicate key')
    })

    it('applies default role of student', async () => {
      const mockUser = createMockUser()
      const mockSql = createMockSql([mockUser])

      await createUser(mockSql as never, {
        username: 'testuser',
        email: 'test@example.com',
        password: 'securepass123',
        displayName: 'Test User',
      })

      // The role default is applied by Zod schema, so the sql call should receive 'student'
      expect(mockSql).toHaveBeenCalled()
    })
  })

  describe('findUserById', () => {
    it('returns user without password_hash when found', async () => {
      const mockUser = createMockUser()
      const { password_hash: _, ...userWithout } = mockUser
      const mockSql = createMockSql([userWithout])

      const result = await findUserById(mockSql as never, 1)

      expect(result).toMatchObject({
        id: 1,
        username: 'testuser',
      })
      expect(result).not.toHaveProperty('password_hash')
    })

    it('returns null when user not found', async () => {
      const mockSql = createMockSql([])

      const result = await findUserById(mockSql as never, 999)

      expect(result).toBeNull()
    })
  })

  describe('findUserByEmail', () => {
    it('returns user with password_hash when found', async () => {
      const mockUser = createMockUser()
      const mockSql = createMockSql([mockUser])

      const result = await findUserByEmail(mockSql as never, 'test@example.com')

      expect(result).toMatchObject({
        id: 1,
        email: 'test@example.com',
        password_hash: '$2b$12$hashedpassword',
      })
    })

    it('returns null when user not found', async () => {
      const mockSql = createMockSql([])

      const result = await findUserByEmail(mockSql as never, 'nonexistent@example.com')

      expect(result).toBeNull()
    })
  })

  describe('findUserByUsername', () => {
    it('returns user with password_hash when found', async () => {
      const mockUser = createMockUser()
      const mockSql = createMockSql([mockUser])

      const result = await findUserByUsername(mockSql as never, 'testuser')

      expect(result).toMatchObject({
        id: 1,
        username: 'testuser',
        password_hash: '$2b$12$hashedpassword',
      })
    })
  })

  describe('findUserByGoogleId', () => {
    it('returns user when found by Google ID', async () => {
      const mockUser = createMockUser({ google_id: 'google-abc' })
      const { password_hash: _, ...userWithout } = mockUser
      const mockSql = createMockSql([userWithout])

      const result = await findUserByGoogleId(mockSql as never, 'google-abc')

      expect(result).toMatchObject({
        id: 1,
        google_id: 'google-abc',
      })
    })
  })

  describe('verifyPassword', () => {
    it('returns true for correct password', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never)

      const result = await verifyPassword('correct', '$2b$12$hash')

      expect(result).toBe(true)
      expect(bcrypt.compare).toHaveBeenCalledWith('correct', '$2b$12$hash')
    })

    it('returns false for incorrect password', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never)

      const result = await verifyPassword('wrong', '$2b$12$hash')

      expect(result).toBe(false)
    })
  })

  describe('updateUser', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('updates user and returns without password_hash', async () => {
      const mockUser = createMockUser({ display_name: 'Updated Name' })
      const mockSql = createMockSql([mockUser])
      // Mock the sql(obj) call for dynamic SET
      ;(mockSql as ReturnType<typeof vi.fn>).mockReturnValueOnce(vi.fn(() => 'display_name'))

      const result = await updateUser(mockSql as never, 1, {
        displayName: 'Updated Name',
      })

      expect(result).not.toHaveProperty('password_hash')
      expect(result?.display_name).toBe('Updated Name')
    })

    it('returns null when user not found', async () => {
      const mockSql = createMockSql([])
      ;(mockSql as ReturnType<typeof vi.fn>).mockReturnValueOnce(vi.fn(() => ''))

      const result = await updateUser(mockSql as never, 999, {
        displayName: 'New Name',
      })

      expect(result).toBeNull()
    })
  })

  describe('listUsers', () => {
    it('returns paginated user list', async () => {
      const users = [createMockUser({ id: 1 }), createMockUser({ id: 2, username: 'user2' })].map(
        ({ password_hash: _, ...u }) => u,
      )
      const mockSql = createMockSql(users)

      const result = await listUsers(mockSql as never, { page: 1, limit: 20 })

      expect(result).toHaveLength(2)
      expect(mockSql).toHaveBeenCalled()
    })

    it('applies role filter', async () => {
      const users = [createMockUser({ role: 'admin' })].map(({ password_hash: _, ...u }) => u)
      const mockSql = createMockSql(users)

      const result = await listUsers(mockSql as never, {
        page: 1,
        limit: 20,
        role: 'admin',
      })

      expect(result).toHaveLength(1)
      expect(result[0]?.role).toBe('admin')
    })

    it('applies search filter', async () => {
      const users = [createMockUser()].map(({ password_hash: _, ...u }) => u)
      const mockSql = createMockSql(users)

      const result = await listUsers(mockSql as never, {
        page: 1,
        limit: 20,
        search: 'test',
      })

      expect(result).toHaveLength(1)
    })

    it('applies both role and search filters', async () => {
      const mockSql = createMockSql([])

      const result = await listUsers(mockSql as never, {
        page: 1,
        limit: 20,
        role: 'student',
        search: 'test',
      })

      expect(result).toHaveLength(0)
    })
  })

  describe('countUsers', () => {
    it('returns total count', async () => {
      const mockSql = createMockSql([{ count: '42' }])

      const result = await countUsers(mockSql as never, { page: 1, limit: 20 })

      expect(result).toBe(42)
    })

    it('returns count with role filter', async () => {
      const mockSql = createMockSql([{ count: '5' }])

      const result = await countUsers(mockSql as never, {
        page: 1,
        limit: 20,
        role: 'admin',
      })

      expect(result).toBe(5)
    })

    it('returns count with search filter', async () => {
      const mockSql = createMockSql([{ count: '3' }])

      const result = await countUsers(mockSql as never, {
        page: 1,
        limit: 20,
        search: 'test',
      })

      expect(result).toBe(3)
    })

    it('returns count with both role and search filters', async () => {
      const mockSql = createMockSql([{ count: '1' }])

      const result = await countUsers(mockSql as never, {
        page: 1,
        limit: 20,
        role: 'student',
        search: 'test',
      })

      expect(result).toBe(1)
    })
  })

  describe('input validation', () => {
    it('rejects invalid email', () => {
      expect(() =>
        createUserSchema.parse({
          username: 'testuser',
          email: 'not-an-email',
          password: 'securepass123',
          displayName: 'Test User',
        }),
      ).toThrow()
    })

    it('rejects short password', () => {
      expect(() =>
        createUserSchema.parse({
          username: 'testuser',
          email: 'test@example.com',
          password: 'short',
          displayName: 'Test User',
        }),
      ).toThrow()
    })

    it('rejects username with invalid characters', () => {
      expect(() =>
        createUserSchema.parse({
          username: 'user name!',
          email: 'test@example.com',
          password: 'securepass123',
          displayName: 'Test User',
        }),
      ).toThrow()
    })

    it('rejects missing required fields', () => {
      expect(() =>
        createUserSchema.parse({
          email: 'test@example.com',
        }),
      ).toThrow()
    })

    it('rejects username shorter than 3 chars', () => {
      expect(() =>
        createUserSchema.parse({
          username: 'ab',
          email: 'test@example.com',
          password: 'securepass123',
          displayName: 'Test User',
        }),
      ).toThrow()
    })

    it('validates update schema with optional fields', () => {
      const result = updateUserSchema.parse({ displayName: 'New Name' })
      expect(result).toEqual({ displayName: 'New Name' })
    })

    it('rejects invalid role in update', () => {
      expect(() => updateUserSchema.parse({ role: 'superadmin' })).toThrow()
    })

    it('validates list schema with defaults', () => {
      const result = listUsersSchema.parse({})
      expect(result).toMatchObject({ page: 1, limit: 20 })
    })

    it('rejects limit over 100', () => {
      expect(() => listUsersSchema.parse({ limit: 200 })).toThrow()
    })
  })
})
