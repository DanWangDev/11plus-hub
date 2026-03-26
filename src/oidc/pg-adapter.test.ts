import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPgAdapter, clearClientCache } from './pg-adapter.js'

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

  sqlFn.json = (value: unknown) => JSON.stringify(value)

  return Object.assign(sqlFn) as unknown as ReturnType<typeof vi.fn>
}

describe('pg-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('upsert', () => {
    it('inserts a payload', async () => {
      const mockSql = createMockSql()
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Session')

      await instance.upsert('session-1', { kind: 'Session' }, 3600)

      expect(mockSql).toHaveBeenCalled()
    })

    it('handles upsert without expiry', async () => {
      const mockSql = createMockSql()
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('AccessToken')

      await instance.upsert('token-1', { kind: 'AccessToken' })

      expect(mockSql).toHaveBeenCalled()
    })
  })

  describe('find', () => {
    it('returns payload when found', async () => {
      const payload = { kind: 'Session', sub: '123' }
      const mockSql = createMockSql([{ payload, consumed_at: null }])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Session')

      const result = await instance.find('session-1')

      expect(result).toEqual(payload)
    })

    it('returns undefined when not found', async () => {
      const mockSql = createMockSql([])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Session')

      const result = await instance.find('nonexistent')

      expect(result).toBeUndefined()
    })

    it('marks consumed payloads', async () => {
      const payload = { kind: 'AuthorizationCode' }
      const mockSql = createMockSql([{ payload, consumed_at: new Date() }])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('AuthorizationCode')

      const result = await instance.find('code-1')

      expect(result).toEqual({ ...payload, consumed: true })
    })
  })

  describe('findByUserCode', () => {
    it('returns payload when found', async () => {
      const payload = { kind: 'DeviceCode', userCode: 'ABCD-1234' }
      const mockSql = createMockSql([{ payload, consumed_at: null }])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('DeviceCode')

      const result = await instance.findByUserCode('ABCD-1234')

      expect(result).toEqual(payload)
    })

    it('returns undefined when not found', async () => {
      const mockSql = createMockSql([])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('DeviceCode')

      const result = await instance.findByUserCode('ZZZZ-9999')

      expect(result).toBeUndefined()
    })
  })

  describe('findByUid', () => {
    it('returns payload when found', async () => {
      const payload = { kind: 'Session' }
      const mockSql = createMockSql([{ payload, consumed_at: null }])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Session')

      const result = await instance.findByUid('uid-123')

      expect(result).toEqual(payload)
    })

    it('returns undefined when not found', async () => {
      const mockSql = createMockSql([])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Session')

      const result = await instance.findByUid('uid-missing')

      expect(result).toBeUndefined()
    })
  })

  describe('consume', () => {
    it('marks payload as consumed', async () => {
      const mockSql = createMockSql()
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('AuthorizationCode')

      await instance.consume('code-1')

      expect(mockSql).toHaveBeenCalled()
    })
  })

  describe('destroy', () => {
    it('deletes payload', async () => {
      const mockSql = createMockSql()
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('AccessToken')

      await instance.destroy('token-1')

      expect(mockSql).toHaveBeenCalled()
    })
  })

  describe('revokeByGrantId', () => {
    it('deletes all payloads for grant', async () => {
      const mockSql = createMockSql()
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('AccessToken')

      await instance.revokeByGrantId('grant-1')

      expect(mockSql).toHaveBeenCalled()
    })
  })

  describe('Client adapter (dynamic loading)', () => {
    const sampleDbApp = {
      client_id: 'test-client-id',
      client_secret_sha256: 'abc123hash',
      redirect_uris: ['https://app.example.com/callback'],
      name: 'Test App',
      slug: 'test-app',
      url: 'https://app.example.com',
      backchannel_logout_uri: null,
      status: 'active',
    }

    beforeEach(() => {
      clearClientCache()
    })

    it('returns client metadata when found', async () => {
      const mockSql = createMockSql([sampleDbApp])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Client')

      const result = await instance.find('test-client-id')

      expect(result).toMatchObject({
        client_id: 'test-client-id',
        client_secret: 'abc123hash',
        client_name: 'Test App',
        redirect_uris: ['https://app.example.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        scope: 'openid profile email hub',
      })
    })

    it('returns undefined when client not found', async () => {
      const mockSql = createMockSql([])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Client')

      const result = await instance.find('nonexistent')

      expect(result).toBeUndefined()
    })

    it('handles public clients (no secret)', async () => {
      const publicApp = { ...sampleDbApp, client_secret_sha256: null }
      const mockSql = createMockSql([publicApp])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Client')

      const result = await instance.find('test-client-id')

      expect(result).not.toHaveProperty('client_secret')
      expect(result).toMatchObject({
        token_endpoint_auth_method: 'none',
      })
    })

    it('includes backchannel_logout_uri when set', async () => {
      const appWithLogout = { ...sampleDbApp, backchannel_logout_uri: 'https://app.example.com/logout' }
      const mockSql = createMockSql([appWithLogout])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Client')

      const result = await instance.find('test-client-id')

      expect(result).toMatchObject({
        backchannel_logout_uri: 'https://app.example.com/logout',
      })
    })

    it('caches results and avoids repeat DB queries', async () => {
      const mockSql = createMockSql([sampleDbApp])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Client')

      await instance.find('test-client-id')
      await instance.find('test-client-id')

      // Should only query DB once due to cache
      expect(mockSql).toHaveBeenCalledTimes(1)
    })

    it('clearClientCache forces fresh DB query', async () => {
      const mockSql = createMockSql([sampleDbApp])
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Client')

      await instance.find('test-client-id')
      clearClientCache()
      await instance.find('test-client-id')

      expect(mockSql).toHaveBeenCalledTimes(2)
    })

    it('no-ops for write operations', async () => {
      const mockSql = createMockSql()
      const adapter = createPgAdapter(mockSql as never)
      const instance = adapter('Client')

      await instance.upsert('id', { kind: 'Client' })
      await instance.consume('id')
      await instance.destroy('id')
      await instance.revokeByGrantId('grant')

      // No DB calls for write operations on Client adapter
      expect(mockSql).not.toHaveBeenCalled()
    })
  })
})
