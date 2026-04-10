import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import {
  createResetToken,
  validateResetToken,
  resetPassword,
  deleteExpiredTokens,
  requestResetSchema,
  resetPasswordSchema,
} from './password-reset-service.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$12$hashedpassword'),
    compare: vi.fn().mockResolvedValue(true),
  },
}))

type TaggedTemplateArgs = [TemplateStringsArray, ...unknown[]]

function createMockSql(returnValue: unknown[] = []) {
  const sqlFn = vi.fn((..._args: TaggedTemplateArgs) =>
    Promise.resolve(returnValue),
  ) as unknown as Record<string, unknown>

  return Object.assign(sqlFn) as unknown as ReturnType<typeof vi.fn>
}

describe('password-reset-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createResetToken', () => {
    it('creates a token with selector and validator', async () => {
      const mockSql = createMockSql()
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // DELETE existing
        .mockResolvedValueOnce([]) // INSERT

      const result = await createResetToken(mockSql as never, 42)

      expect(result.selector).toBeDefined()
      expect(result.validator).toBeDefined()
      expect(result.selector.length).toBe(32) // 16 bytes hex
      expect(result.validator.length).toBe(64) // 32 bytes hex
      expect(mockSql).toHaveBeenCalledTimes(2)
    })
  })

  describe('validateResetToken', () => {
    it('returns userId for valid token', async () => {
      const validator = crypto.randomBytes(32).toString('hex')
      const validatorHash = crypto.createHash('sha256').update(validator).digest('hex')

      const mockSql = createMockSql([
        {
          id: 1,
          user_id: 42,
          selector: 'abc123',
          validator_hash: validatorHash,
          expires_at: new Date(Date.now() + 3600000),
          created_at: new Date(),
        },
      ])

      const result = await validateResetToken(mockSql as never, 'abc123', validator)

      expect(result).toEqual({ userId: 42 })
    })

    it('returns null for expired or missing token', async () => {
      const mockSql = createMockSql([])

      const result = await validateResetToken(mockSql as never, 'nonexistent', 'whatever')

      expect(result).toBeNull()
    })

    it('returns null for invalid validator', async () => {
      const mockSql = createMockSql([
        {
          id: 1,
          user_id: 42,
          selector: 'abc123',
          validator_hash: 'wrong-hash',
          expires_at: new Date(Date.now() + 3600000),
          created_at: new Date(),
        },
      ])

      const result = await validateResetToken(mockSql as never, 'abc123', 'bad-validator')

      expect(result).toBeNull()
    })
  })

  describe('resetPassword', () => {
    it('resets password and deletes token on success', async () => {
      const validator = crypto.randomBytes(32).toString('hex')
      const validatorHash = crypto.createHash('sha256').update(validator).digest('hex')

      const mockSql = createMockSql()
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([
          {
            id: 1,
            user_id: 42,
            selector: 'sel123',
            validator_hash: validatorHash,
            expires_at: new Date(Date.now() + 3600000),
            created_at: new Date(),
          },
        ]) // validateResetToken SELECT
        .mockResolvedValueOnce([]) // UPDATE users
        .mockResolvedValueOnce([]) // DELETE token

      const result = await resetPassword(mockSql as never, {
        selector: 'sel123',
        validator,
        newPassword: 'newpassword123',
      })

      expect(result).toBe(true)
      expect(mockSql).toHaveBeenCalledTimes(3)
    })

    it('returns false for invalid token', async () => {
      const mockSql = createMockSql([])

      const result = await resetPassword(mockSql as never, {
        selector: 'nonexistent',
        validator: 'invalid',
        newPassword: 'newpassword123',
      })

      expect(result).toBe(false)
    })
  })

  describe('deleteExpiredTokens', () => {
    it('deletes expired tokens and returns count', async () => {
      const mockResult = Object.assign([], { count: 5, command: 'DELETE' })
      const mockSql = vi.fn().mockResolvedValue(mockResult)

      const count = await deleteExpiredTokens(mockSql as never)

      expect(count).toBe(5)
    })
  })

  describe('input validation', () => {
    it('rejects invalid email in requestResetSchema', () => {
      expect(() => requestResetSchema.parse({ email: 'not-an-email' })).toThrow()
    })

    it('accepts valid email in requestResetSchema', () => {
      const result = requestResetSchema.parse({ email: 'test@example.com' })
      expect(result.email).toBe('test@example.com')
    })

    it('rejects short password in resetPasswordSchema', () => {
      expect(() =>
        resetPasswordSchema.parse({
          selector: 'abc',
          validator: 'def',
          newPassword: 'short',
        }),
      ).toThrow()
    })

    it('rejects empty selector in resetPasswordSchema', () => {
      expect(() =>
        resetPasswordSchema.parse({
          selector: '',
          validator: 'def',
          newPassword: 'longpassword123',
        }),
      ).toThrow()
    })

    it('accepts valid resetPasswordSchema input', () => {
      const result = resetPasswordSchema.parse({
        selector: 'abc123',
        validator: 'def456',
        newPassword: 'strongpassword',
      })
      expect(result.selector).toBe('abc123')
    })
  })
})
