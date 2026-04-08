import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { createStripeCheckoutRouter } from './stripe-checkout.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const mockCreateCheckoutSession = vi.fn()
const mockCreatePortalSession = vi.fn()

vi.mock('../services/stripe-service.js', () => ({
  createCheckoutSession: (...args: unknown[]) => mockCreateCheckoutSession(...args),
  createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
}))

type TaggedTemplateArgs = [TemplateStringsArray, ...unknown[]]

function createMockSql(returnValue: unknown[] = []) {
  return vi.fn((..._args: TaggedTemplateArgs) =>
    Promise.resolve(returnValue),
  )
}

/** Fake auth middleware that sets res.locals.user */
function fakeAuth(user: { sub?: string; email?: string } | undefined) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.locals.user = user
    next()
  }
}

function createTestApp(
  user: { sub?: string; email?: string } | undefined,
  sqlReturnValue: unknown[] = [],
) {
  const app = express()
  app.use(express.json())
  app.use(fakeAuth(user))

  const mockStripe = {} as never
  const mockSql = createMockSql(sqlReturnValue)

  app.use(
    createStripeCheckoutRouter({
      stripe: mockStripe,
      sql: mockSql as never,
      priceId: 'price_test_123',
      hubOrigin: 'http://localhost:3009',
    }),
  )

  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/stripe/checkout', () => {
  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(undefined)

    const res = await request(app).post('/api/stripe/checkout')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Not authenticated')
  })

  it('returns 400 when user has no email', async () => {
    const app = createTestApp({ sub: '42', email: '' })

    const res = await request(app).post('/api/stripe/checkout')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('User email required for checkout')
  })

  it('returns checkout URL on success', async () => {
    mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.com/session_123')

    const app = createTestApp({ sub: '42', email: 'parent@example.com' })

    const res = await request(app).post('/api/stripe/checkout')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.url).toBe('https://checkout.stripe.com/session_123')
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        priceId: 'price_test_123',
        userId: 42,
        userEmail: 'parent@example.com',
      }),
    )
  })
})

describe('POST /api/stripe/portal', () => {
  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(undefined)

    const res = await request(app).post('/api/stripe/portal')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Not authenticated')
  })

  it('returns 404 when no billing account found', async () => {
    const app = createTestApp({ sub: '42' }, [])

    const res = await request(app).post('/api/stripe/portal')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('No billing account found')
  })

  it('returns portal URL on success', async () => {
    mockCreatePortalSession.mockResolvedValue('https://billing.stripe.com/portal_123')

    const app = createTestApp(
      { sub: '42' },
      [{ stripe_customer_id: 'cus_test_abc' }],
    )

    const res = await request(app).post('/api/stripe/portal')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.url).toBe('https://billing.stripe.com/portal_123')
    expect(mockCreatePortalSession).toHaveBeenCalledWith(
      expect.anything(),
      'cus_test_abc',
      'http://localhost:3009/dashboard',
    )
  })
})
