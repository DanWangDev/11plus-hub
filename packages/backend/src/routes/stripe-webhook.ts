import { Router } from 'express'
import type { Request, Response } from 'express'
import express from 'express'
import type Stripe from 'stripe'
import type postgres from 'postgres'
import { createLogger } from '../lib/logger.js'
import {
  constructWebhookEvent,
  isEventProcessed,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
} from '../services/stripe-service.js'

const logger = createLogger({ service: 'stripe-webhook' })

export interface StripeWebhookOptions {
  stripe: Stripe
  sql: postgres.Sql
  webhookSecret: string
}

export function createStripeWebhookRouter(options: StripeWebhookOptions): Router {
  const router = Router()
  const { stripe, sql, webhookSecret } = options

  // Raw body parser — must be applied BEFORE express.json() in app.ts.
  // Stripe signature verification requires the raw request body.
  router.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      const signature = req.headers['stripe-signature']
      if (!signature || typeof signature !== 'string') {
        logger.warn('webhook: missing stripe-signature header', {
          operation: 'stripeWebhook',
        })
        res.status(400).json({ error: 'Missing stripe-signature header' })
        return
      }

      let event: Stripe.Event
      try {
        event = constructWebhookEvent(stripe, req.body as Buffer, signature, webhookSecret)
      } catch (err) {
        logger.warn('webhook: signature verification failed', {
          operation: 'stripeWebhook',
          error: err instanceof Error ? err.message : String(err),
        })
        res.status(400).json({ error: 'Invalid signature' })
        return
      }

      // Idempotency check
      const alreadyProcessed = await isEventProcessed(sql, event.id)
      if (alreadyProcessed) {
        logger.info('webhook: duplicate event skipped', {
          operation: 'stripeWebhook',
          eventId: event.id,
          type: event.type,
        })
        res.status(200).json({ received: true })
        return
      }

      try {
        switch (event.type) {
          case 'checkout.session.completed':
            await handleCheckoutCompleted(sql, event)
            break
          case 'customer.subscription.updated':
            await handleSubscriptionUpdated(sql, event)
            break
          case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(sql, event)
            break
          default:
            logger.info('webhook: unhandled event type', {
              operation: 'stripeWebhook',
              type: event.type,
            })
        }

        res.status(200).json({ received: true })
      } catch (err) {
        logger.error('webhook: handler failed', {
          operation: 'stripeWebhook',
          eventId: event.id,
          type: event.type,
          error: err instanceof Error ? err.message : String(err),
        })
        // Return 200 to prevent Stripe from retrying on application errors.
        // The event is NOT marked as processed so manual replay can fix it.
        res.status(200).json({ received: true })
      }
    },
  )

  return router
}
