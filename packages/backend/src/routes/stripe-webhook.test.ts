import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createStripeWebhookRouter } from './stripe-webhook.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const mockConstructWebhookEvent = vi.fn()
const mockIsEventProcessed = vi.fn()
const mockHandleCheckoutCompleted = vi.fn()
const mockHandleSubscriptionUpdated = vi.fn()
const mockHandleSubscriptionDeleted = vi.fn()

vi.mock('../services/stripe-service.js', () => ({
  constructWebhookEvent: (...args: unknown[]) => mockConstructWebhookEvent(...args),
  isEventProcessed: (...args: unknown[]) => mockIsEventProcessed(...args),
  handleCheckoutCompleted: (...args: unknown[]) => mockHandleCheckoutCompleted(...args),
  handleSubscriptionUpdated: (...args: unknown[]) => mockHandleSubscriptionUpdated(...args),
  handleSubscriptionDeleted: (...args: unknown[]) => mockHandleSubscriptionDeleted(...args),
}))

function createTestApp() {
  const app = express()
  const mockStripe = {} as never
  const mockSql = vi.fn() as never

  app.use(
    createStripeWebhookRouter({
      stripe: mockStripe,
      sql: mockSql,
      webhookSecret: 'whsec_test',
    }),
  )

  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/stripe/webhook', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const app = createTestApp()

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send('{}')

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Missing stripe-signature header')
  })

  it('returns 400 when signature verification fails', async () => {
    mockConstructWebhookEvent.mockImplementation(() => {
      throw new Error('Invalid signature')
    })

    const app = createTestApp()

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'sig_invalid')
      .send('{}')

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid signature')
  })

  it('returns 200 and skips duplicate events', async () => {
    mockConstructWebhookEvent.mockReturnValue({
      id: 'evt_duplicate',
      type: 'checkout.session.completed',
    })
    mockIsEventProcessed.mockResolvedValue(true)

    const app = createTestApp()

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'sig_valid')
      .send('{}')

    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    expect(mockHandleCheckoutCompleted).not.toHaveBeenCalled()
  })

  it('routes checkout.session.completed to handler', async () => {
    mockConstructWebhookEvent.mockReturnValue({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
    })
    mockIsEventProcessed.mockResolvedValue(false)
    mockHandleCheckoutCompleted.mockResolvedValue(undefined)

    const app = createTestApp()

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'sig_valid')
      .send('{}')

    expect(res.status).toBe(200)
    expect(mockHandleCheckoutCompleted).toHaveBeenCalledTimes(1)
  })

  it('routes customer.subscription.updated to handler', async () => {
    mockConstructWebhookEvent.mockReturnValue({
      id: 'evt_updated',
      type: 'customer.subscription.updated',
    })
    mockIsEventProcessed.mockResolvedValue(false)
    mockHandleSubscriptionUpdated.mockResolvedValue(undefined)

    const app = createTestApp()

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'sig_valid')
      .send('{}')

    expect(res.status).toBe(200)
    expect(mockHandleSubscriptionUpdated).toHaveBeenCalledTimes(1)
  })

  it('routes customer.subscription.deleted to handler', async () => {
    mockConstructWebhookEvent.mockReturnValue({
      id: 'evt_deleted',
      type: 'customer.subscription.deleted',
    })
    mockIsEventProcessed.mockResolvedValue(false)
    mockHandleSubscriptionDeleted.mockResolvedValue(undefined)

    const app = createTestApp()

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'sig_valid')
      .send('{}')

    expect(res.status).toBe(200)
    expect(mockHandleSubscriptionDeleted).toHaveBeenCalledTimes(1)
  })

  it('returns 200 for unhandled event types', async () => {
    mockConstructWebhookEvent.mockReturnValue({
      id: 'evt_other',
      type: 'invoice.payment_failed',
    })
    mockIsEventProcessed.mockResolvedValue(false)

    const app = createTestApp()

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'sig_valid')
      .send('{}')

    expect(res.status).toBe(200)
    expect(mockHandleCheckoutCompleted).not.toHaveBeenCalled()
    expect(mockHandleSubscriptionUpdated).not.toHaveBeenCalled()
    expect(mockHandleSubscriptionDeleted).not.toHaveBeenCalled()
  })

  it('returns 200 even when handler throws (prevents Stripe retries)', async () => {
    mockConstructWebhookEvent.mockReturnValue({
      id: 'evt_fail',
      type: 'checkout.session.completed',
    })
    mockIsEventProcessed.mockResolvedValue(false)
    mockHandleCheckoutCompleted.mockRejectedValue(new Error('DB connection lost'))

    const app = createTestApp()

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'sig_valid')
      .send('{}')

    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
  })
})
