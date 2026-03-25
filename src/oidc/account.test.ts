import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAccountFinder } from './account.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const mockFindUserById = vi.fn()
const mockFindSubscriptionByUserId = vi.fn()
const mockGetUserAppAccess = vi.fn()

vi.mock('../services/user-service.js', () => ({
  findUserById: (...args: unknown[]) => mockFindUserById(...args),
}))

vi.mock('../services/subscription-service.js', () => ({
  findSubscriptionByUserId: (...args: unknown[]) => mockFindSubscriptionByUserId(...args),
  getUserAppAccess: (...args: unknown[]) => mockGetUserAppAccess(...args),
}))

type TaggedTemplateArgs = [TemplateStringsArray, ...unknown[]]

function createMockSql(returnValue: unknown[] = []) {
  const sqlFn = vi.fn((..._args: TaggedTemplateArgs) =>
    Promise.resolve(returnValue),
  ) as unknown as Record<string, unknown>

  return Object.assign(sqlFn) as unknown as ReturnType<typeof vi.fn>
}

describe('account finder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns undefined for non-numeric sub', async () => {
    const mockSql = createMockSql()
    const findAccount = createAccountFinder(mockSql as never)

    const result = await findAccount(null, 'not-a-number')

    expect(result).toBeUndefined()
  })

  it('returns undefined when user not found', async () => {
    const mockSql = createMockSql()
    mockFindUserById.mockResolvedValue(null)
    const findAccount = createAccountFinder(mockSql as never)

    const result = await findAccount(null, '999')

    expect(result).toBeUndefined()
  })

  it('returns account with claims for valid user', async () => {
    const user = {
      id: 42,
      username: 'emma',
      display_name: 'Emma Wang',
      email: 'emma@example.com',
      email_verified: true,
      role: 'student',
    }
    const subscription = {
      plan: 'bundle',
      features: ['writing', 'vocab'],
    }

    mockFindUserById.mockResolvedValue(user)
    mockFindSubscriptionByUserId.mockResolvedValue(subscription)
    mockGetUserAppAccess.mockResolvedValue([{ app_id: 1 }, { app_id: 2 }])

    const mockSql = createMockSql([{ slug: 'writing-buddy' }, { slug: 'vocab-master' }])
    const findAccount = createAccountFinder(mockSql as never)

    const result = await findAccount(null, '42')

    expect(result).toBeDefined()
    expect(result?.accountId).toBe('42')

    const claims = await result!.claims()

    expect(claims).toMatchObject({
      sub: '42',
      username: 'emma',
      display_name: 'Emma Wang',
      email: 'emma@example.com',
      email_verified: true,
      role: 'student',
      plan: 'bundle',
      features: ['writing', 'vocab'],
      apps: ['writing-buddy', 'vocab-master'],
      expires_at: null,
    })
  })

  it('defaults to free plan when no subscription', async () => {
    const user = {
      id: 10,
      username: 'parent1',
      display_name: 'Parent',
      email: 'parent@example.com',
      email_verified: true,
      role: 'parent',
    }

    mockFindUserById.mockResolvedValue(user)
    mockFindSubscriptionByUserId.mockResolvedValue(null)
    mockGetUserAppAccess.mockResolvedValue([])

    const mockSql = createMockSql()
    const findAccount = createAccountFinder(mockSql as never)

    const result = await findAccount(null, '10')
    const claims = await result!.claims()

    expect(claims.plan).toBe('free')
    expect(claims.features).toEqual([])
    expect(claims.apps).toEqual([])
    expect(claims.expires_at).toBeNull()
  })

  it('includes expires_at from subscription', async () => {
    const user = {
      id: 42,
      username: 'emma',
      display_name: 'Emma Wang',
      email: 'emma@example.com',
      email_verified: true,
      role: 'student',
    }
    const expDate = new Date('2027-01-01T00:00:00Z')
    const subscription = {
      plan: 'vocab',
      features: ['vocab'],
      expires_at: expDate,
    }

    mockFindUserById.mockResolvedValue(user)
    mockFindSubscriptionByUserId.mockResolvedValue(subscription)
    mockGetUserAppAccess.mockResolvedValue([{ app_id: 1 }])

    const mockSql = createMockSql([{ slug: 'vocab-master' }])
    const findAccount = createAccountFinder(mockSql as never)

    const result = await findAccount(null, '42')
    const claims = await result!.claims()

    expect(claims.expires_at).toBe('2027-01-01T00:00:00.000Z')
  })
})
