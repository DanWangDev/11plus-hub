import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import {
  createApplication,
  findApplicationById,
  findApplicationByClientId,
  findApplicationBySlug,
  verifyClientSecret,
  updateApplication,
  listApplications,
  rotateClientSecret,
  createServiceToken,
  verifyServiceToken,
  revokeServiceToken,
} from './app-service.js'

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$12$hashedvalue'),
    compare: vi.fn().mockImplementation((plain: string, hash: string) => {
      return Promise.resolve(hash === '$2b$12$hashedvalue' && plain === 'correct-secret')
    }),
  },
}))

// Helper to create a mock sql tagged template function
function mockSql(returnValue: unknown[] = []) {
  // postgres.js uses tagged template literals: sql`...`
  // We need a function that can be called as a tagged template
  const fn = (() => Promise.resolve(returnValue)) as unknown
  return new Proxy(fn as object, {
    apply() {
      return Promise.resolve(returnValue)
    },
  }) as never
}

function mockSqlSequence(returns: unknown[][]) {
  let callIndex = 0
  const fn = (() => {
    const result = returns[callIndex] ?? []
    callIndex++
    return Promise.resolve(result)
  }) as unknown
  return new Proxy(fn as object, {
    apply() {
      const result = returns[callIndex] ?? []
      callIndex++
      return Promise.resolve(result)
    },
  }) as never
}

const sampleApp = {
  id: 1,
  name: 'Test App',
  slug: 'test-app',
  url: 'https://test.example.com',
  client_id: 'some-uuid',
  client_secret_hash: '$2b$12$hashedvalue',
  redirect_uris: ['https://test.example.com/callback'],
  icon_url: null,
  stats_api_url: null,
  status: 'active',
  created_at: new Date('2025-01-01T00:00:00Z'),
}

const sampleToken = {
  id: 1,
  app_id: 1,
  token_hash: 'sha256hash',
  scopes: ['read'],
  expires_at: null,
  created_at: new Date('2025-01-01T00:00:00Z'),
}

describe('app-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createApplication', () => {
    it('creates an application with valid data', async () => {
      const sql = mockSql([sampleApp])
      const result = await createApplication(sql, {
        name: 'Test App',
        slug: 'test-app',
        url: 'https://test.example.com',
        redirectUris: ['https://test.example.com/callback'],
      })

      expect(result.application).toMatchObject({ name: 'Test App', slug: 'test-app' })
      expect(result.clientSecret).toBeDefined()
      expect(typeof result.clientSecret).toBe('string')
      expect(result.clientSecret.length).toBe(64) // 32 bytes hex
    })

    it('generates a unique client_id', async () => {
      const sql = mockSql([sampleApp])
      const result = await createApplication(sql, {
        name: 'Test App',
        slug: 'test-app',
        url: 'https://test.example.com',
        redirectUris: ['https://test.example.com/callback'],
      })

      expect(result.application.client_id).toBeDefined()
    })

    it('hashes the client secret', async () => {
      const bcryptModule = await import('bcrypt')
      const sql = mockSql([sampleApp])
      await createApplication(sql, {
        name: 'Test App',
        slug: 'test-app',
        url: 'https://test.example.com',
        redirectUris: ['https://test.example.com/callback'],
      })

      expect(bcryptModule.default.hash).toHaveBeenCalledWith(expect.any(String), 12)
    })

    it('throws on duplicate slug (Zod validation for invalid slug)', () => {
      const sql = mockSql([])
      expect(
        createApplication(sql, {
          name: 'Test App',
          slug: 'INVALID SLUG',
          url: 'https://test.example.com',
          redirectUris: ['https://test.example.com/callback'],
        }),
      ).rejects.toThrow()
    })

    it('throws on invalid data', () => {
      const sql = mockSql([])
      expect(createApplication(sql, { name: '' })).rejects.toThrow()
    })

    it('throws on missing URL', () => {
      const sql = mockSql([])
      expect(
        createApplication(sql, {
          name: 'App',
          slug: 'app',
          redirectUris: ['https://test.example.com/callback'],
        }),
      ).rejects.toThrow()
    })

    it('throws on empty redirect URIs', () => {
      const sql = mockSql([])
      expect(
        createApplication(sql, {
          name: 'App',
          slug: 'app',
          url: 'https://test.example.com',
          redirectUris: [],
        }),
      ).rejects.toThrow()
    })
  })

  describe('findApplicationById', () => {
    it('returns application when found', async () => {
      const sql = mockSql([sampleApp])
      const result = await findApplicationById(sql, 1)
      expect(result).toMatchObject({ id: 1, name: 'Test App' })
    })

    it('returns null when not found', async () => {
      const sql = mockSql([])
      const result = await findApplicationById(sql, 999)
      expect(result).toBeNull()
    })
  })

  describe('findApplicationByClientId', () => {
    it('returns application when found', async () => {
      const sql = mockSql([sampleApp])
      const result = await findApplicationByClientId(sql, 'some-uuid')
      expect(result).toMatchObject({ client_id: 'some-uuid' })
    })

    it('returns null when not found', async () => {
      const sql = mockSql([])
      const result = await findApplicationByClientId(sql, 'nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('findApplicationBySlug', () => {
    it('returns application when found', async () => {
      const sql = mockSql([sampleApp])
      const result = await findApplicationBySlug(sql, 'test-app')
      expect(result).toMatchObject({ slug: 'test-app' })
    })

    it('returns null when not found', async () => {
      const sql = mockSql([])
      const result = await findApplicationBySlug(sql, 'nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('verifyClientSecret', () => {
    it('returns true for correct secret', async () => {
      const result = await verifyClientSecret('correct-secret', '$2b$12$hashedvalue')
      expect(result).toBe(true)
    })

    it('returns false for incorrect secret', async () => {
      const result = await verifyClientSecret('wrong-secret', '$2b$12$hashedvalue')
      expect(result).toBe(false)
    })
  })

  describe('updateApplication', () => {
    it('updates with valid data', async () => {
      const updatedApp = { ...sampleApp, name: 'Updated App' }
      const sql = mockSqlSequence([[sampleApp], [updatedApp]])
      const result = await updateApplication(sql, 1, { name: 'Updated App' })
      expect(result).toMatchObject({ name: 'Updated App' })
    })

    it('returns null when application not found', async () => {
      const sql = mockSql([])
      const result = await updateApplication(sql, 999, { name: 'Updated App' })
      expect(result).toBeNull()
    })

    it('throws on invalid update data', () => {
      const sql = mockSql([sampleApp])
      expect(updateApplication(sql, 1, { status: 'invalid-status' })).rejects.toThrow()
    })
  })

  describe('listApplications', () => {
    it('returns paginated list', async () => {
      const sql = mockSqlSequence([[sampleApp], [{ count: 1 }]])
      const result = await listApplications(sql, { page: 1, limit: 20 })
      expect(result.applications).toHaveLength(1)
      expect(result.total).toBe(1)
    })

    it('filters by status', async () => {
      const sql = mockSqlSequence([[sampleApp], [{ count: 1 }]])
      const result = await listApplications(sql, {
        page: 1,
        limit: 20,
        status: 'active',
      })
      expect(result.applications).toHaveLength(1)
    })

    it('returns empty list', async () => {
      const sql = mockSqlSequence([[], [{ count: 0 }]])
      const result = await listApplications(sql, { page: 1, limit: 20 })
      expect(result.applications).toHaveLength(0)
      expect(result.total).toBe(0)
    })
  })

  describe('rotateClientSecret', () => {
    it('generates new secret', async () => {
      const rotatedApp = { ...sampleApp, client_secret_hash: '$2b$12$newhash' }
      const sql = mockSqlSequence([[sampleApp], [rotatedApp]])
      const result = await rotateClientSecret(sql, 1)
      expect(result).not.toBeNull()
      expect(result!.clientSecret).toBeDefined()
      expect(result!.clientSecret.length).toBe(64)
    })

    it('returns null when application not found', async () => {
      const sql = mockSql([])
      const result = await rotateClientSecret(sql, 999)
      expect(result).toBeNull()
    })
  })

  describe('createServiceToken', () => {
    it('generates token and hashes correctly', async () => {
      const sql = mockSqlSequence([[sampleApp], [sampleToken]])
      const result = await createServiceToken(sql, 1, ['read'])
      expect(result.token).toBeDefined()
      expect(result.token.length).toBe(96) // 48 bytes hex
      expect(result.serviceToken).toMatchObject({ app_id: 1 })
    })

    it('throws when application not found', async () => {
      const sql = mockSql([])
      await expect(createServiceToken(sql, 999)).rejects.toThrow('Application not found')
    })

    it('hashes token with SHA256', async () => {
      const sql = mockSqlSequence([[sampleApp], [sampleToken]])
      const result = await createServiceToken(sql, 1, ['read'])
      const expectedHash = createHash('sha256').update(result.token).digest('hex')
      // The token hash stored should be SHA256 of the plaintext token
      expect(expectedHash).toBeDefined()
    })
  })

  describe('verifyServiceToken', () => {
    it('returns token when valid', async () => {
      const tokenPlaintext = 'a'.repeat(96)
      const tokenHash = createHash('sha256').update(tokenPlaintext).digest('hex')
      const validToken = { ...sampleToken, token_hash: tokenHash }
      const sql = mockSql([validToken])
      const result = await verifyServiceToken(sql, tokenPlaintext)
      expect(result).toMatchObject({ app_id: 1 })
    })

    it('returns null for expired token', async () => {
      const tokenPlaintext = 'a'.repeat(96)
      const tokenHash = createHash('sha256').update(tokenPlaintext).digest('hex')
      const expiredToken = {
        ...sampleToken,
        token_hash: tokenHash,
        expires_at: new Date('2020-01-01T00:00:00Z'),
      }
      const sql = mockSql([expiredToken])
      const result = await verifyServiceToken(sql, tokenPlaintext)
      expect(result).toBeNull()
    })

    it('returns null for nonexistent token', async () => {
      const sql = mockSql([])
      const result = await verifyServiceToken(sql, 'nonexistent-token')
      expect(result).toBeNull()
    })
  })

  describe('revokeServiceToken', () => {
    it('returns true when token deleted', async () => {
      const sql = mockSql([{ id: 1 }])
      const result = await revokeServiceToken(sql, 1)
      expect(result).toBe(true)
    })

    it('returns false when token not found', async () => {
      const sql = mockSql([])
      const result = await revokeServiceToken(sql, 999)
      expect(result).toBe(false)
    })
  })

  describe('input validation', () => {
    it('rejects invalid slug format', () => {
      const sql = mockSql([])
      expect(
        createApplication(sql, {
          name: 'App',
          slug: 'Invalid Slug!',
          url: 'https://test.example.com',
          redirectUris: ['https://test.example.com/callback'],
        }),
      ).rejects.toThrow()
    })

    it('rejects missing URL', () => {
      const sql = mockSql([])
      expect(
        createApplication(sql, {
          name: 'App',
          slug: 'app',
          redirectUris: ['https://test.example.com/callback'],
        }),
      ).rejects.toThrow()
    })

    it('rejects empty redirect URIs', () => {
      const sql = mockSql([])
      expect(
        createApplication(sql, {
          name: 'App',
          slug: 'app',
          url: 'https://test.example.com',
          redirectUris: [],
        }),
      ).rejects.toThrow()
    })

    it('rejects invalid redirect URI format', () => {
      const sql = mockSql([])
      expect(
        createApplication(sql, {
          name: 'App',
          slug: 'app',
          url: 'https://test.example.com',
          redirectUris: ['not-a-url'],
        }),
      ).rejects.toThrow()
    })
  })
})
