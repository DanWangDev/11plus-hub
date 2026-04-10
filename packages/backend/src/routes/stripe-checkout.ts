import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import type Stripe from 'stripe'
import { createLogger } from '../lib/logger.js'
import { createCheckoutSession, createPortalSession } from '../services/stripe-service.js'
import type postgres from 'postgres'

const logger = createLogger({ service: 'stripe-checkout' })

export interface StripeCheckoutOptions {
  stripe: Stripe
  sql: postgres.Sql
  priceId: string
  hubOrigin: string
}

export function createStripeCheckoutRouter(options: StripeCheckoutOptions): Router {
  const router = Router()
  const { stripe, priceId, hubOrigin, sql } = options

  // POST /api/stripe/checkout — create Stripe Checkout Session
  router.post('/api/stripe/checkout', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const user = res.locals.user as { sub?: string; email?: string } | undefined
      if (!user?.sub) {
        res.status(401).json({ success: false, error: 'Not authenticated' })
        return
      }

      const userId = Number(user.sub)
      const email = user.email ?? ''

      if (!email) {
        res.status(400).json({ success: false, error: 'User email required for checkout' })
        return
      }

      const url = await createCheckoutSession(stripe, {
        priceId,
        userId,
        userEmail: email,
        successUrl: `${hubOrigin}/dashboard?payment=success`,
        cancelUrl: `${hubOrigin}/pricing`,
      })

      logger.info('checkout session redirect', {
        operation: 'stripeCheckout',
        userId,
      })

      res.json({ success: true, data: { url } })
    } catch (error) {
      logger.error('checkout session creation failed', {
        operation: 'stripeCheckout',
        error: error instanceof Error ? error.message : String(error),
      })
      next(error)
    }
  })

  // POST /api/stripe/portal — create Stripe Customer Portal Session
  router.post('/api/stripe/portal', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const user = res.locals.user as { sub?: string } | undefined
      if (!user?.sub) {
        res.status(401).json({ success: false, error: 'Not authenticated' })
        return
      }

      const userId = Number(user.sub)

      // Look up Stripe customer ID from subscription
      const rows = await sql<{ stripe_customer_id: string }[]>`
        SELECT stripe_customer_id FROM subscriptions
        WHERE user_id = ${userId} AND stripe_customer_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      `

      const stripeCustomerId = rows[0]?.stripe_customer_id
      if (!stripeCustomerId) {
        res.status(404).json({ success: false, error: 'No billing account found' })
        return
      }

      const url = await createPortalSession(stripe, stripeCustomerId, `${hubOrigin}/dashboard`)

      logger.info('portal session redirect', {
        operation: 'stripePortal',
        userId,
      })

      res.json({ success: true, data: { url } })
    } catch (error) {
      logger.error('portal session creation failed', {
        operation: 'stripePortal',
        error: error instanceof Error ? error.message : String(error),
      })
      next(error)
    }
  })

  return router
}
