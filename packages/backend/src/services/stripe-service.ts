import Stripe from 'stripe'
import type postgres from 'postgres'
import { createLogger } from '../lib/logger.js'
import { logAction, AuditActions } from './audit-service.js'
import { syncAppAccessFromPlan, getFeatures } from './subscription-service.js'

const logger = createLogger({ service: 'stripe-service' })

type Sql = postgres.Sql
// postgres.js TransactionSql is callable as tagged template at runtime
// but the type system doesn't expose the call signature cleanly.
// Use Sql for both — the transaction object is structurally compatible.
type TxSql = postgres.Sql

// --- Stripe status mapping ---

const STRIPE_STATUS_MAP: Record<string, string> = {
  trialing: 'trial',
  active: 'active',
  canceled: 'cancelled',
  past_due: 'past_due',
  incomplete: 'incomplete',
  incomplete_expired: 'expired',
  unpaid: 'past_due',
}

function mapStripeStatus(stripeStatus: string): string {
  return STRIPE_STATUS_MAP[stripeStatus] ?? 'active'
}

// --- Stripe client ---

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: '2025-03-31.basil',
  })
}

// --- Checkout ---

export async function createCheckoutSession(
  stripe: Stripe,
  options: {
    priceId: string
    userId: number
    userEmail: string
    successUrl: string
    cancelUrl: string
  },
): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: options.priceId, quantity: 1 }],
    customer_email: options.userEmail,
    client_reference_id: String(options.userId),
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    automatic_tax: { enabled: true },
    metadata: { hub_user_id: String(options.userId) },
  })

  logger.info('checkout session created', {
    operation: 'createCheckoutSession',
    sessionId: session.id,
    userId: options.userId,
  })

  return session.url!
}

// --- Customer Portal ---

export async function createPortalSession(
  stripe: Stripe,
  stripeCustomerId: string,
  returnUrl: string,
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  })

  return session.url
}

// --- Webhook event processing ---

export function constructWebhookEvent(
  stripe: Stripe,
  body: Buffer,
  signature: string,
  webhookSecret: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(body, signature, webhookSecret)
}

export async function isEventProcessed(sql: Sql, eventId: string): Promise<boolean> {
  const rows = await sql<{ event_id: string }[]>`
    SELECT event_id FROM stripe_processed_events WHERE event_id = ${eventId}
  `
  return rows.length > 0
}

async function markEventProcessed(sql: Sql, eventId: string): Promise<void> {
  await sql`
    INSERT INTO stripe_processed_events (event_id)
    VALUES (${eventId})
    ON CONFLICT (event_id) DO NOTHING
  `
}

// --- Webhook handlers ---

export async function handleCheckoutCompleted(sql: Sql, event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session
  const userId = session.client_reference_id
    ? Number(session.client_reference_id)
    : session.metadata?.hub_user_id
      ? Number(session.metadata.hub_user_id)
      : null

  if (!userId) {
    logger.error('checkout.session.completed: no user ID found', {
      operation: 'handleCheckoutCompleted',
      sessionId: session.id,
    })
    return
  }

  const stripeCustomerId = session.customer as string
  const stripeSubscriptionId = session.subscription as string
  const plan = 'writing' // Phase 1: single product
  const features = getFeatures(plan)

  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as TxSql
    // Cancel any existing active/trial subscription for this user
    await tx`
      UPDATE subscriptions
      SET status = 'cancelled'
      WHERE user_id = ${userId} AND status IN ('active', 'trial', 'past_due')
    `

    // Insert new subscription with Stripe IDs
    await tx`
      INSERT INTO subscriptions (user_id, plan, status, features, stripe_customer_id, stripe_subscription_id)
      VALUES (${userId}, ${plan}, 'active', ${features}, ${stripeCustomerId}, ${stripeSubscriptionId})
    `

    await syncAppAccessFromPlan(tx, userId, plan)
    await markEventProcessed(tx, event.id)
  })

  await logAction(sql, {
    actorId: null,
    action: AuditActions.STRIPE_WEBHOOK_CHECKOUT,
    targetId: userId,
    details: {
      stripeCustomerId,
      stripeSubscriptionId,
      plan,
      sessionId: session.id,
    },
  }).catch((err) => {
    logger.warn('audit log failed for checkout', { error: String(err) })
  })

  logger.info('checkout completed', {
    operation: 'handleCheckoutCompleted',
    userId,
    plan,
    stripeCustomerId,
  })
}

export async function handleSubscriptionUpdated(sql: Sql, event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription
  const stripeSubscriptionId = subscription.id
  const hubStatus = mapStripeStatus(subscription.status)

  // Find our subscription by Stripe subscription ID
  const rows = await sql<{ id: number; user_id: number; plan: string; status: string }[]>`
    SELECT id, user_id, plan, status FROM subscriptions
    WHERE stripe_subscription_id = ${stripeSubscriptionId}
  `
  const existing = rows[0]

  if (!existing) {
    logger.warn('subscription.updated: no matching subscription', {
      operation: 'handleSubscriptionUpdated',
      stripeSubscriptionId,
    })
    return
  }

  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as TxSql
    await tx`
      UPDATE subscriptions
      SET status = ${hubStatus}
      WHERE id = ${existing.id}
    `

    // Revoke access if status indicates non-entitlement
    if (['cancelled', 'expired', 'incomplete'].includes(hubStatus)) {
      await syncAppAccessFromPlan(tx, existing.user_id, 'free')
    }

    await markEventProcessed(tx, event.id)
  })

  await logAction(sql, {
    actorId: null,
    action: AuditActions.STRIPE_WEBHOOK_UPDATED,
    targetId: existing.user_id,
    details: {
      subscriptionId: existing.id,
      stripeSubscriptionId,
      oldStatus: existing.status,
      newStatus: hubStatus,
      stripeStatus: subscription.status,
    },
  }).catch((err) => {
    logger.warn('audit log failed for subscription update', { error: String(err) })
  })

  logger.info('subscription updated via webhook', {
    operation: 'handleSubscriptionUpdated',
    subscriptionId: existing.id,
    userId: existing.user_id,
    oldStatus: existing.status,
    newStatus: hubStatus,
  })
}

export async function handleSubscriptionDeleted(sql: Sql, event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription
  const stripeSubscriptionId = subscription.id

  const rows = await sql<{ id: number; user_id: number; status: string }[]>`
    SELECT id, user_id, status FROM subscriptions
    WHERE stripe_subscription_id = ${stripeSubscriptionId}
  `
  const existing = rows[0]

  if (!existing) {
    logger.warn('subscription.deleted: no matching subscription', {
      operation: 'handleSubscriptionDeleted',
      stripeSubscriptionId,
    })
    return
  }

  // Already cancelled — no-op
  if (existing.status === 'cancelled') {
    await markEventProcessed(sql, event.id)
    return
  }

  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as TxSql
    await tx`
      UPDATE subscriptions
      SET status = 'cancelled'
      WHERE id = ${existing.id}
    `

    await syncAppAccessFromPlan(tx, existing.user_id, 'free')
    await markEventProcessed(tx, event.id)
  })

  await logAction(sql, {
    actorId: null,
    action: AuditActions.STRIPE_WEBHOOK_CANCELLED,
    targetId: existing.user_id,
    details: {
      subscriptionId: existing.id,
      stripeSubscriptionId,
    },
  }).catch((err) => {
    logger.warn('audit log failed for subscription deletion', { error: String(err) })
  })

  logger.info('subscription cancelled via webhook', {
    operation: 'handleSubscriptionDeleted',
    subscriptionId: existing.id,
    userId: existing.user_id,
  })
}
