import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadClientsFromDb, verifyClientSecret } from './client-loader.js'
import { createHash } from 'crypto'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

type TaggedTemplateArgs = [TemplateStringsArray, ...unknown[]]

function createMockSql(returnValue: unknown[] = []) {
  const sqlFn = vi.fn((..._args: TaggedTemplateArgs) =>
    Promise.resolve(returnValue),
  ) as unknown as Record<string, unknown>

  return Object.assign(sqlFn) as unknown as ReturnType<typeof vi.fn>
}

describe('verifyClientSecret', () => {
  it('returns true for matching secret', () => {
    const secret = 'my-test-secret'
    const sha256 = createHash('sha256').update(secret).digest('hex')
    expect(verifyClientSecret(secret, sha256)).toBe(true)
  })

  it('returns false for wrong secret', () => {
    const sha256 = createHash('sha256').update('correct-secret').digest('hex')
    expect(verifyClientSecret('wrong-secret', sha256)).toBe(false)
  })

  it('returns false for empty secret', () => {
    const sha256 = createHash('sha256').update('some-secret').digest('hex')
    expect(verifyClientSecret('', sha256)).toBe(false)
  })
})

describe('loadClientsFromDb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads active applications as OIDC clients', async () => {
    const sha256 = createHash('sha256').update('test-secret').digest('hex')
    const mockSql = createMockSql([
      {
        client_id: 'vocab-master-client',
        client_secret_sha256: sha256,
        redirect_uris: ['http://localhost:5174/auth/callback'],
        name: 'Vocab Master',
        slug: 'vocab-master',
        url: 'https://vocab-master.labf.app',
      },
    ])

    const clients = await loadClientsFromDb(mockSql as never)

    expect(clients).toHaveLength(1)
    expect(clients[0]).toMatchObject({
      client_id: 'vocab-master-client',
      client_secret: sha256,
      client_name: 'Vocab Master',
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'openid profile email hub',
      post_logout_redirect_uris: ['https://vocab-master.labf.app', 'http://localhost:5174'],
    })
  })

  it('sets auth method to none when no SHA-256 hash', async () => {
    const mockSql = createMockSql([
      {
        client_id: 'legacy-client',
        client_secret_sha256: null,
        redirect_uris: ['http://localhost:3000/callback'],
        name: 'Legacy App',
        slug: 'legacy',
        url: 'http://localhost:3000',
      },
    ])

    const clients = await loadClientsFromDb(mockSql as never)

    expect(clients[0]).toMatchObject({
      token_endpoint_auth_method: 'none',
    })
    expect(clients[0]).not.toHaveProperty('client_secret')
  })

  it('returns empty array when no applications', async () => {
    const mockSql = createMockSql([])
    const clients = await loadClientsFromDb(mockSql as never)
    expect(clients).toEqual([])
  })
})
