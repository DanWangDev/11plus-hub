import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkUserEntitlement } from './entitlement-check.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const mockCheckEntitlement = vi.fn()

vi.mock('../services/subscription-service.js', () => ({
  checkEntitlement: (...args: unknown[]) => mockCheckEntitlement(...args),
}))

type TaggedTemplateArgs = [TemplateStringsArray, ...unknown[]]

function createMockSql(returnValue: unknown[] = []) {
  const sqlFn = vi.fn((..._args: TaggedTemplateArgs) =>
    Promise.resolve(returnValue),
  ) as unknown as Record<string, unknown>

  return Object.assign(sqlFn) as unknown as ReturnType<typeof vi.fn>
}

describe('checkUserEntitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns allowed when user has entitlement', async () => {
    const mockSql = createMockSql([{ slug: 'vocab-master', name: 'Vocab Master' }])
    mockCheckEntitlement.mockResolvedValue(true)

    const result = await checkUserEntitlement(mockSql as never, 1, 'vocab-master-client')

    expect(result).toEqual({ allowed: true, appName: 'Vocab Master' })
    expect(mockCheckEntitlement).toHaveBeenCalledWith(expect.anything(), 1, 'vocab-master')
  })

  it('returns denied when user lacks entitlement', async () => {
    const mockSql = createMockSql([{ slug: 'writing-buddy', name: 'Writing Buddy' }])
    mockCheckEntitlement.mockResolvedValue(false)

    const result = await checkUserEntitlement(mockSql as never, 1, 'writing-buddy-client')

    expect(result).toEqual({
      allowed: false,
      appName: 'Writing Buddy',
      reason: 'no_entitlement',
    })
  })

  it('returns denied for unknown client_id', async () => {
    const mockSql = createMockSql([])

    const result = await checkUserEntitlement(mockSql as never, 1, 'unknown-client')

    expect(result).toEqual({
      allowed: false,
      reason: 'unknown_client',
    })
    expect(mockCheckEntitlement).not.toHaveBeenCalled()
  })
})
