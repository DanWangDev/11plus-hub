import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  logAction,
  getAuditLogs,
  countAuditLogs,
  getAuditLogById,
  getActorHistory,
  AuditActions,
} from './audit-service.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Helper to create a mock sql tagged template function
function mockSql(returnValue: unknown[] = []) {
  const fn = (() => Promise.resolve(returnValue)) as unknown
  const handler = {
    apply() {
      return Promise.resolve(returnValue)
    },
    get(_target: object, prop: string) {
      if (prop === 'unsafe') {
        return (value: string) => value
      }
      return undefined
    },
  }
  return new Proxy(fn as object, handler) as never
}

const sampleAuditLog = {
  id: 1,
  actor_id: 42,
  action: 'login',
  target_id: null,
  details: {},
  ip_address: '127.0.0.1',
  created_at: new Date('2025-01-01T00:00:00Z'),
}

describe('audit-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('logAction', () => {
    it('inserts a valid audit log entry', async () => {
      const sql = mockSql([sampleAuditLog])
      const result = await logAction(sql, {
        actorId: 42,
        action: AuditActions.LOGIN,
        ipAddress: '127.0.0.1',
      })

      expect(result).toMatchObject({
        id: 1,
        actor_id: 42,
        action: 'login',
        ip_address: '127.0.0.1',
      })
    })

    it('inserts with all fields provided', async () => {
      const fullEntry = {
        ...sampleAuditLog,
        action: 'user_update',
        target_id: 10,
        details: { reason: 'manual' },
      }
      const sql = mockSql([fullEntry])
      const result = await logAction(sql, {
        actorId: 42,
        action: AuditActions.USER_UPDATE,
        targetId: 10,
        details: { reason: 'manual' },
        ipAddress: '127.0.0.1',
      })

      expect(result).toMatchObject({
        actor_id: 42,
        action: 'user_update',
        target_id: 10,
        details: { reason: 'manual' },
      })
    })

    it('inserts with minimal fields', async () => {
      const minimalEntry = {
        ...sampleAuditLog,
        action: 'system_event',
        actor_id: null,
        ip_address: null,
        details: {},
      }
      const sql = mockSql([minimalEntry])
      const result = await logAction(sql, {
        action: 'system_event',
      })

      expect(result).toMatchObject({
        action: 'system_event',
        actor_id: null,
        ip_address: null,
      })
    })

    it('throws when insert returns no rows', async () => {
      const sql = mockSql([])
      await expect(logAction(sql, { action: AuditActions.LOGIN })).rejects.toThrow(
        'Failed to create audit log entry',
      )
    })

    it('throws on invalid data — empty action', () => {
      const sql = mockSql([])
      expect(logAction(sql, { action: '' })).rejects.toThrow()
    })

    it('throws on invalid data — action too long', () => {
      const sql = mockSql([])
      expect(logAction(sql, { action: 'x'.repeat(101) })).rejects.toThrow()
    })

    it('throws on invalid actorId', () => {
      const sql = mockSql([])
      expect(logAction(sql, { actorId: -1, action: 'login' })).rejects.toThrow()
    })
  })

  describe('getAuditLogs', () => {
    it('returns paginated list with default params', async () => {
      const sql = mockSql([sampleAuditLog])
      const result = await getAuditLogs(sql, {})

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 1 })
    })

    it('returns empty list when no results', async () => {
      const sql = mockSql([])
      const result = await getAuditLogs(sql, {})

      expect(result).toHaveLength(0)
    })

    it('applies action filter', async () => {
      const sql = mockSql([sampleAuditLog])
      const result = await getAuditLogs(sql, { action: 'login' })

      expect(result).toHaveLength(1)
    })

    it('applies actorId filter', async () => {
      const sql = mockSql([sampleAuditLog])
      const result = await getAuditLogs(sql, { actorId: 42 })

      expect(result).toHaveLength(1)
    })

    it('applies date range filter', async () => {
      const sql = mockSql([sampleAuditLog])
      const result = await getAuditLogs(sql, {
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-12-31T23:59:59Z',
      })

      expect(result).toHaveLength(1)
    })

    it('applies pagination', async () => {
      const sql = mockSql([sampleAuditLog])
      const result = await getAuditLogs(sql, { page: 2, limit: 10 })

      expect(result).toHaveLength(1)
    })
  })

  describe('countAuditLogs', () => {
    it('returns count with no filters', async () => {
      const sql = mockSql([{ count: '5' }])
      const result = await countAuditLogs(sql, {})

      expect(result).toBe(5)
    })

    it('returns count with filters', async () => {
      const sql = mockSql([{ count: '3' }])
      const result = await countAuditLogs(sql, { action: 'login' })

      expect(result).toBe(3)
    })

    it('returns 0 when no results', async () => {
      const sql = mockSql([{ count: '0' }])
      const result = await countAuditLogs(sql, {})

      expect(result).toBe(0)
    })

    it('returns 0 when rows are empty', async () => {
      const sql = mockSql([])
      const result = await countAuditLogs(sql, {})

      expect(result).toBe(0)
    })
  })

  describe('getAuditLogById', () => {
    it('returns entry when found', async () => {
      const sql = mockSql([sampleAuditLog])
      const result = await getAuditLogById(sql, 1)

      expect(result).toMatchObject({ id: 1, action: 'login' })
    })

    it('returns null when not found', async () => {
      const sql = mockSql([])
      const result = await getAuditLogById(sql, 999)

      expect(result).toBeNull()
    })
  })

  describe('getActorHistory', () => {
    it('returns entries for a specific actor', async () => {
      const sql = mockSql([sampleAuditLog])
      const result = await getActorHistory(sql, 42)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ actor_id: 42 })
    })

    it('returns empty list when actor has no entries', async () => {
      const sql = mockSql([])
      const result = await getActorHistory(sql, 999)

      expect(result).toHaveLength(0)
    })

    it('applies pagination to actor history', async () => {
      const sql = mockSql([sampleAuditLog])
      const result = await getActorHistory(sql, 42, { page: 1, limit: 10 })

      expect(result).toHaveLength(1)
    })
  })

  describe('input validation', () => {
    it('rejects non-numeric actorId in list', () => {
      const sql = mockSql([])
      expect(getAuditLogs(sql, { actorId: 'abc' })).rejects.toThrow()
    })

    it('rejects negative page number', () => {
      const sql = mockSql([])
      expect(getAuditLogs(sql, { page: -1 })).rejects.toThrow()
    })

    it('rejects limit over 100', () => {
      const sql = mockSql([])
      expect(getAuditLogs(sql, { limit: 200 })).rejects.toThrow()
    })

    it('rejects invalid datetime for startDate', () => {
      const sql = mockSql([])
      expect(getAuditLogs(sql, { startDate: 'not-a-date' })).rejects.toThrow()
    })

    it('rejects invalid datetime for endDate', () => {
      const sql = mockSql([])
      expect(getAuditLogs(sql, { endDate: 'not-a-date' })).rejects.toThrow()
    })
  })

  describe('AuditActions constants', () => {
    it('has expected action values', () => {
      expect(AuditActions.LOGIN).toBe('login')
      expect(AuditActions.LOGIN_FAILED).toBe('login_failed')
      expect(AuditActions.REGISTER).toBe('register')
      expect(AuditActions.LOGOUT).toBe('logout')
      expect(AuditActions.USER_UPDATE).toBe('user_update')
      expect(AuditActions.USER_DELETE).toBe('user_delete')
      expect(AuditActions.IMPERSONATE_START).toBe('impersonate_start')
      expect(AuditActions.IMPERSONATE_END).toBe('impersonate_end')
    })
  })
})
