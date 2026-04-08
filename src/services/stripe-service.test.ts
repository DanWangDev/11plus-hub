import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isEventProcessed,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
} from './stripe-service.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('./audit-service.js', () => ({
  logAction: vi.fn().mockResolvedValue({}),
  AuditActions: {
    STRIPE_WEBHOOK_CHECKOUT: 'stripe_webhook_checkout',
    STRIPE_WEBHOOK_UPDATED: 'stripe_webhook_updated',
    STRIPE_WEBHOOK_CANCELLED: 'stripe_webhook_cancelled',
  },
}))

vi.mock('./subscription-service.js', () => ({
  syncAppAccessFromPlan: vi.fn().mockResolvedValue(undefined),
  getFeatures: vi.fn((plan: string) => {
    const map: Record<string, string[]> = {
      free: [],
      writing: ['writing'],
      bundle: ['writing', 'vocab'],
    }
    return map[plan] ?? []
  }),
}))

type TaggedTemplateArgs = [TemplateStringsArray, ...unknown[]]

function createMockSql(returnValue: unknown[] = []) {
  const sqlFn = vi.fn((..._args: TaggedTemplateArgs) =>
    Promise.resolve(returnValue),
  ) as unknown as Record<string, unknown>

  // Add begin() for transaction support
  const beginFn = vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
    const txFn = vi.fn((..._args: TaggedTemplateArgs) =>
      Promise.resolve([]),
    )
    await callback(txFn)
  })
  ;(sqlFn as Record<string, unknown>).begin = beginFn

  return Object.assign(sqlFn) as unknown as ReturnType<typeof vi.fn> & { begin: typeof beginFn }
}

function createStripeEvent(type: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `evt_test_${Date.now()}`,
    type,
    data: { object: data },
  }
}

describe('stripe-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isEventProcessed', () => {
    it('returns false when event not found', async () => {
      const mockSql = createMockSql([])
      const result = await isEventProcessed(mockSql as never, 'evt_123')
      expect(result).toBe(false)
    })

    it('returns true when event exists', async () => {
      const mockSql = createMockSql([{ event_id: 'evt_123' }])
      const result = await isEventProcessed(mockSql as never, 'evt_123')
      expect(result).toBe(true)
    })
  })

  describe('handleCheckoutCompleted', () => {
    it('creates subscription with Stripe IDs', async () => {
      const mockSql = createMockSql()
      const event = createStripeEvent('checkout.session.completed', {
        id: 'cs_test_123',
        client_reference_id: '42',
        customer: 'cus_test_abc',
        subscription: 'sub_test_def',
        metadata: { hub_user_id: '42' },
      })

      await handleCheckoutCompleted(mockSql as never, event as never)

      expect(mockSql.begin).toHaveBeenCalledTimes(1)
    })

    it('skips when no user ID found', async () => {
      const mockSql = createMockSql()
      const event = createStripeEvent('checkout.session.completed', {
        id: 'cs_test_123',
        client_reference_id: null,
        customer: 'cus_test_abc',
        subscription: 'sub_test_def',
        metadata: {},
      })

      await handleCheckoutCompleted(mockSql as never, event as never)

      expect(mockSql.begin).not.toHaveBeenCalled()
    })
  })

  describe('handleSubscriptionUpdated', () => {
    it('updates subscription status', async () => {
      const mockSql = createMockSql([{ id: 1, user_id: 42, plan: 'writing', status: 'active' }])
      const event = createStripeEvent('customer.subscription.updated', {
        id: 'sub_test_def',
        status: 'past_due',
      })

      await handleSubscriptionUpdated(mockSql as never, event as never)

      expect(mockSql.begin).toHaveBeenCalledTimes(1)
    })

    it('skips when no matching subscription found', async () => {
      const mockSql = createMockSql([])
      const event = createStripeEvent('customer.subscription.updated', {
        id: 'sub_unknown',
        status: 'active',
      })

      await handleSubscriptionUpdated(mockSql as never, event as never)

      expect(mockSql.begin).not.toHaveBeenCalled()
    })
  })

  describe('handleSubscriptionDeleted', () => {
    it('cancels subscription and revokes access', async () => {
      const mockSql = createMockSql([{ id: 1, user_id: 42, status: 'active' }])
      const event = createStripeEvent('customer.subscription.deleted', {
        id: 'sub_test_def',
      })

      await handleSubscriptionDeleted(mockSql as never, event as never)

      expect(mockSql.begin).toHaveBeenCalledTimes(1)
    })

    it('is a no-op for already cancelled subscription', async () => {
      const mockSql = createMockSql([{ id: 1, user_id: 42, status: 'cancelled' }])
      const event = createStripeEvent('customer.subscription.deleted', {
        id: 'sub_test_def',
      })

      await handleSubscriptionDeleted(mockSql as never, event as never)

      // No transaction needed — just marks event as processed
      expect(mockSql.begin).not.toHaveBeenCalled()
      // But sql is called for the lookup + markEventProcessed
      expect(mockSql).toHaveBeenCalledTimes(2)
    })

    it('skips when no matching subscription found', async () => {
      const mockSql = createMockSql([])
      const event = createStripeEvent('customer.subscription.deleted', {
        id: 'sub_unknown',
      })

      await handleSubscriptionDeleted(mockSql as never, event as never)

      expect(mockSql.begin).not.toHaveBeenCalled()
    })
  })
})
