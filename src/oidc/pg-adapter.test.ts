import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPgAdapter } from './pg-adapter.js'

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
})
