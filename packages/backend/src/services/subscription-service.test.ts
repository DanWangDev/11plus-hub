import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSubscription,
  findSubscriptionByUserId,
  findSubscriptionById,
  updateSubscription,
  cancelSubscription,
  listSubscriptions,
  countSubscriptions,
  getFeatures,
  grantAppAccess,
  revokeAppAccess,
  getUserAppAccess,
  syncAppAccessFromPlan,
  checkEntitlement,
  createSubscriptionSchema,
  updateSubscriptionSchema,
  listSubscriptionsSchema,
} from './subscription-service.js'

type TaggedTemplateArgs = [TemplateStringsArray, ...unknown[]]

function createMockSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 10,
    plan: 'bundle',
    status: 'active',
    features: ['writing', 'vocab'],
    expires_at: null,
    assigned_by: null,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

function createMockSql(returnValue: unknown[] = []) {
  const sqlFn = vi.fn((..._args: TaggedTemplateArgs) =>
    Promise.resolve(returnValue),
  ) as unknown as Record<string, unknown>

  return Object.assign(sqlFn) as unknown as ReturnType<typeof vi.fn>
}

describe('subscription-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getFeatures', () => {
    it('returns empty array for free plan', () => {
      expect(getFeatures('free')).toEqual([])
    })

    it('returns writing for writing plan', () => {
      expect(getFeatures('writing')).toEqual(['writing'])
    })

    it('returns vocab for vocab plan', () => {
      expect(getFeatures('vocab')).toEqual(['vocab'])
    })

    it('returns both for bundle plan', () => {
      expect(getFeatures('bundle')).toEqual(['writing', 'vocab'])
    })

    it('returns both for family plan', () => {
      expect(getFeatures('family')).toEqual(['writing', 'vocab'])
    })

    it('returns empty array for unknown plan', () => {
      expect(getFeatures('unknown')).toEqual([])
    })
  })

  describe('createSubscription', () => {
    it('creates a subscription and syncs app access', async () => {
      const mockSub = createMockSubscription({ plan: 'writing', features: ['writing'] })
      const mockSql = vi.fn() as unknown as ReturnType<typeof vi.fn>
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([mockSub]) // INSERT subscription
        .mockResolvedValueOnce([]) // syncAppAccessFromPlan CTE

      const result = await createSubscription(mockSql as never, {
        userId: 10,
        plan: 'writing',
      })

      expect(result).toMatchObject({
        id: 1,
        user_id: 10,
        plan: 'writing',
      })
      // 1 INSERT + 1 syncAppAccessFromPlan CTE
      expect(mockSql).toHaveBeenCalledTimes(2)
    })

    it('creates a subscription with custom features override', async () => {
      const mockSub = createMockSubscription({ features: ['custom-feature'] })
      const mockSql = vi.fn() as unknown as ReturnType<typeof vi.fn>
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([mockSub]) // INSERT subscription
        .mockResolvedValueOnce([]) // syncAppAccessFromPlan CTE (bundle = both apps)

      const result = await createSubscription(mockSql as never, {
        userId: 10,
        plan: 'bundle',
        features: ['custom-feature'],
      })

      expect(result).toMatchObject({ id: 1 })
    })

    it('creates with default plan and status (free = no app access)', async () => {
      const mockSub = createMockSubscription({ plan: 'free', status: 'active', features: [] })
      const mockSql = vi.fn() as unknown as ReturnType<typeof vi.fn>
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([mockSub]) // INSERT subscription
        .mockResolvedValueOnce([]) // syncAppAccessFromPlan DELETE (free = no grants)

      const result = await createSubscription(mockSql as never, {
        userId: 10,
      })

      expect(result.plan).toBe('free')
      expect(result.status).toBe('active')
    })

    it('throws when insert fails', async () => {
      const mockSql = createMockSql([])

      await expect(
        createSubscription(mockSql as never, { userId: 10, plan: 'bundle' }),
      ).rejects.toThrow('Failed to create subscription')
    })
  })

  describe('findSubscriptionByUserId', () => {
    it('returns active subscription for user', async () => {
      const mockSub = createMockSubscription()
      const mockSql = createMockSql([mockSub])

      const result = await findSubscriptionByUserId(mockSql as never, 10)

      expect(result).toMatchObject({ user_id: 10, status: 'active' })
    })

    it('returns null when no active subscription found', async () => {
      const mockSql = createMockSql([])

      const result = await findSubscriptionByUserId(mockSql as never, 999)

      expect(result).toBeNull()
    })
  })

  describe('findSubscriptionById', () => {
    it('returns subscription when found', async () => {
      const mockSub = createMockSubscription()
      const mockSql = createMockSql([mockSub])

      const result = await findSubscriptionById(mockSql as never, 1)

      expect(result).toMatchObject({ id: 1 })
    })

    it('returns null when not found', async () => {
      const mockSql = createMockSql([])

      const result = await findSubscriptionById(mockSql as never, 999)

      expect(result).toBeNull()
    })
  })

  describe('updateSubscription', () => {
    it('updates plan, recomputes features, and syncs app access', async () => {
      const existing = createMockSubscription({ plan: 'free', features: [] })
      const updated = createMockSubscription({
        plan: 'bundle',
        features: ['writing', 'vocab'],
        user_id: 10,
      })

      const mockSql = vi.fn() as unknown as ReturnType<typeof vi.fn>
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([existing]) // findSubscriptionById
        .mockResolvedValueOnce([updated]) // UPDATE subscription
        .mockResolvedValueOnce([]) // syncAppAccessFromPlan CTE

      const result = await updateSubscription(mockSql as never, 1, { plan: 'bundle' })

      expect(result).toMatchObject({ plan: 'bundle', features: ['writing', 'vocab'] })
      expect(mockSql).toHaveBeenCalledTimes(3)
    })

    it('updates status to active without syncing app access', async () => {
      const existing = createMockSubscription()
      const updated = createMockSubscription({ status: 'active' })

      const mockSql = vi.fn() as unknown as ReturnType<typeof vi.fn>
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([existing])
        .mockResolvedValueOnce([updated])

      const result = await updateSubscription(mockSql as never, 1, { status: 'active' })

      expect(result).toMatchObject({ status: 'active' })
      // No syncAppAccessFromPlan when status change doesn't revoke access
      expect(mockSql).toHaveBeenCalledTimes(2)
    })

    it('revokes app access when status changes to cancelled', async () => {
      const existing = createMockSubscription({ status: 'active' })
      const updated = createMockSubscription({ status: 'cancelled' })

      const mockSql = vi.fn() as unknown as ReturnType<typeof vi.fn>
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([existing]) // findSubscriptionById
        .mockResolvedValueOnce([updated]) // UPDATE subscription
        .mockResolvedValueOnce([]) // syncAppAccessFromPlan (DELETE for free plan)

      const result = await updateSubscription(mockSql as never, 1, { status: 'cancelled' })

      expect(result).toMatchObject({ status: 'cancelled' })
      // findById + UPDATE + syncAppAccessFromPlan(free) = 3 calls
      expect(mockSql).toHaveBeenCalledTimes(3)
    })

    it('revokes app access when status changes to expired', async () => {
      const existing = createMockSubscription({ status: 'active' })
      const updated = createMockSubscription({ status: 'expired' })

      const mockSql = vi.fn() as unknown as ReturnType<typeof vi.fn>
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([existing])
        .mockResolvedValueOnce([updated])
        .mockResolvedValueOnce([]) // syncAppAccessFromPlan (DELETE for free plan)

      const result = await updateSubscription(mockSql as never, 1, { status: 'expired' })

      expect(result).toMatchObject({ status: 'expired' })
      expect(mockSql).toHaveBeenCalledTimes(3)
    })

    it('returns null when subscription not found', async () => {
      const mockSql = createMockSql([])

      const result = await updateSubscription(mockSql as never, 999, { plan: 'bundle' })

      expect(result).toBeNull()
    })
  })

  describe('cancelSubscription', () => {
    it('sets status to cancelled and revokes app access', async () => {
      const cancelled = createMockSubscription({ status: 'cancelled' })
      const mockSql = vi.fn() as unknown as ReturnType<typeof vi.fn>
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([cancelled]) // UPDATE subscription
        .mockResolvedValueOnce([]) // syncAppAccessFromPlan (DELETE for free plan)

      const result = await cancelSubscription(mockSql as never, 1)

      expect(result).toMatchObject({ status: 'cancelled' })
      // UPDATE + syncAppAccessFromPlan(free) = 2 calls
      expect(mockSql).toHaveBeenCalledTimes(2)
    })

    it('returns null when subscription not found', async () => {
      const mockSql = createMockSql([])

      const result = await cancelSubscription(mockSql as never, 999)

      expect(result).toBeNull()
    })
  })

  describe('listSubscriptions', () => {
    it('returns paginated list', async () => {
      const subs = [createMockSubscription({ id: 1 }), createMockSubscription({ id: 2 })]
      const mockSql = createMockSql(subs)

      const result = await listSubscriptions(mockSql as never, { page: 1, limit: 20 })

      expect(result).toHaveLength(2)
    })

    it('applies plan filter', async () => {
      const subs = [createMockSubscription({ plan: 'writing' })]
      const mockSql = createMockSql(subs)

      const result = await listSubscriptions(mockSql as never, {
        page: 1,
        limit: 20,
        plan: 'writing',
      })

      expect(result).toHaveLength(1)
    })

    it('applies status filter', async () => {
      const subs = [createMockSubscription({ status: 'trial' })]
      const mockSql = createMockSql(subs)

      const result = await listSubscriptions(mockSql as never, {
        page: 1,
        limit: 20,
        status: 'trial',
      })

      expect(result).toHaveLength(1)
    })

    it('applies userId filter', async () => {
      const subs = [createMockSubscription({ user_id: 5 })]
      const mockSql = createMockSql(subs)

      const result = await listSubscriptions(mockSql as never, {
        page: 1,
        limit: 20,
        userId: 5,
      })

      expect(result).toHaveLength(1)
    })

    it('applies plan and status filters together', async () => {
      const mockSql = createMockSql([])

      const result = await listSubscriptions(mockSql as never, {
        page: 1,
        limit: 20,
        plan: 'bundle',
        status: 'active',
      })

      expect(result).toHaveLength(0)
    })
  })

  describe('countSubscriptions', () => {
    it('returns total count', async () => {
      const mockSql = createMockSql([{ count: '42' }])

      const result = await countSubscriptions(mockSql as never, { page: 1, limit: 20 })

      expect(result).toBe(42)
    })

    it('returns count with plan filter', async () => {
      const mockSql = createMockSql([{ count: '5' }])

      const result = await countSubscriptions(mockSql as never, {
        page: 1,
        limit: 20,
        plan: 'bundle',
      })

      expect(result).toBe(5)
    })

    it('returns count with status filter', async () => {
      const mockSql = createMockSql([{ count: '3' }])

      const result = await countSubscriptions(mockSql as never, {
        page: 1,
        limit: 20,
        status: 'active',
      })

      expect(result).toBe(3)
    })
  })

  describe('grantAppAccess', () => {
    it('grants access and returns record', async () => {
      const access = { user_id: 10, app_id: 1, granted_at: new Date() }
      const mockSql = createMockSql([access])

      const result = await grantAppAccess(mockSql as never, 10, 1)

      expect(result).toMatchObject({ user_id: 10, app_id: 1 })
    })

    it('returns existing record on conflict', async () => {
      const existing = { user_id: 10, app_id: 1, granted_at: new Date() }
      const mockSql = createMockSql([])
      ;(mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // INSERT returns nothing (conflict)
        .mockResolvedValueOnce([existing]) // SELECT returns existing

      const result = await grantAppAccess(mockSql as never, 10, 1)

      expect(result).toMatchObject({ user_id: 10, app_id: 1 })
    })
  })

  describe('revokeAppAccess', () => {
    it('returns true when access was revoked', async () => {
      const mockSql = createMockSql([{ user_id: 10 }])

      const result = await revokeAppAccess(mockSql as never, 10, 1)

      expect(result).toBe(true)
    })

    it('returns false when no access existed', async () => {
      const mockSql = createMockSql([])

      const result = await revokeAppAccess(mockSql as never, 10, 1)

      expect(result).toBe(false)
    })
  })

  describe('getUserAppAccess', () => {
    it('returns list of app access entries', async () => {
      const entries = [
        { user_id: 10, app_id: 1, granted_at: new Date() },
        { user_id: 10, app_id: 2, granted_at: new Date() },
      ]
      const mockSql = createMockSql(entries)

      const result = await getUserAppAccess(mockSql as never, 10)

      expect(result).toHaveLength(2)
    })

    it('returns empty array when no access', async () => {
      const mockSql = createMockSql([])

      const result = await getUserAppAccess(mockSql as never, 10)

      expect(result).toHaveLength(0)
    })
  })

  describe('syncAppAccessFromPlan', () => {
    it('syncs access for writing plan in single CTE', async () => {
      const mockSql = createMockSql([])

      await syncAppAccessFromPlan(mockSql as never, 10, 'writing')

      // Single CTE: DELETE + INSERT in one statement
      expect(mockSql).toHaveBeenCalledTimes(1)
    })

    it('syncs access for bundle plan in single CTE', async () => {
      const mockSql = createMockSql([])

      await syncAppAccessFromPlan(mockSql as never, 10, 'bundle')

      // Single CTE for both apps
      expect(mockSql).toHaveBeenCalledTimes(1)
    })

    it('removes all access for free plan', async () => {
      const mockSql = createMockSql([])

      await syncAppAccessFromPlan(mockSql as never, 10, 'free')

      // Just DELETE (no CTE needed for empty slug list)
      expect(mockSql).toHaveBeenCalledTimes(1)
    })

    it('syncs access for family plan in single CTE', async () => {
      const mockSql = createMockSql([])

      await syncAppAccessFromPlan(mockSql as never, 10, 'family')

      expect(mockSql).toHaveBeenCalledTimes(1)
    })

    it('handles unknown plan by removing all access', async () => {
      const mockSql = createMockSql([])

      await syncAppAccessFromPlan(mockSql as never, 10, 'unknown')

      // Unknown plan → empty slugs → DELETE only
      expect(mockSql).toHaveBeenCalledTimes(1)
    })
  })

  describe('checkEntitlement', () => {
    it('returns true when user has access', async () => {
      const mockSql = createMockSql([{ user_id: 10 }])

      const result = await checkEntitlement(mockSql as never, 10, 'writing-buddy')

      expect(result).toBe(true)
    })

    it('returns false when user does not have access', async () => {
      const mockSql = createMockSql([])

      const result = await checkEntitlement(mockSql as never, 10, 'writing-buddy')

      expect(result).toBe(false)
    })
  })

  describe('input validation', () => {
    it('rejects invalid plan in createSubscriptionSchema', () => {
      expect(() =>
        createSubscriptionSchema.parse({
          userId: 1,
          plan: 'premium',
        }),
      ).toThrow()
    })

    it('rejects invalid status in createSubscriptionSchema', () => {
      expect(() =>
        createSubscriptionSchema.parse({
          userId: 1,
          status: 'paused',
        }),
      ).toThrow()
    })

    it('accepts past_due status in createSubscriptionSchema', () => {
      const result = createSubscriptionSchema.parse({
        userId: 1,
        status: 'past_due',
      })
      expect(result.status).toBe('past_due')
    })

    it('accepts incomplete status in createSubscriptionSchema', () => {
      const result = createSubscriptionSchema.parse({
        userId: 1,
        status: 'incomplete',
      })
      expect(result.status).toBe('incomplete')
    })

    it('rejects negative userId', () => {
      expect(() =>
        createSubscriptionSchema.parse({
          userId: -1,
          plan: 'free',
        }),
      ).toThrow()
    })

    it('validates updateSubscriptionSchema with optional fields', () => {
      const result = updateSubscriptionSchema.parse({ plan: 'writing' })
      expect(result).toEqual({ plan: 'writing' })
    })

    it('rejects invalid plan in updateSubscriptionSchema', () => {
      expect(() => updateSubscriptionSchema.parse({ plan: 'premium' })).toThrow()
    })

    it('rejects invalid status in updateSubscriptionSchema', () => {
      expect(() => updateSubscriptionSchema.parse({ status: 'paused' })).toThrow()
    })

    it('accepts past_due and incomplete in updateSubscriptionSchema', () => {
      expect(updateSubscriptionSchema.parse({ status: 'past_due' }).status).toBe('past_due')
      expect(updateSubscriptionSchema.parse({ status: 'incomplete' }).status).toBe('incomplete')
    })

    it('validates listSubscriptionsSchema with defaults', () => {
      const result = listSubscriptionsSchema.parse({})
      expect(result).toMatchObject({ page: 1, limit: 20 })
    })

    it('rejects limit over 100', () => {
      expect(() => listSubscriptionsSchema.parse({ limit: 200 })).toThrow()
    })
  })
})
