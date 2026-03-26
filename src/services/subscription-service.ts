import { z } from 'zod'
import type postgres from 'postgres'
import { AppError } from '../middleware/error-handler.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'subscription-service' })

// --- Plan-to-features mapping ---

const PLAN_FEATURES: Record<string, string[]> = {
  free: [],
  writing: ['writing'],
  vocab: ['vocab'],
  bundle: ['writing', 'vocab'],
  family: ['writing', 'vocab'],
}

const PLAN_APP_SLUGS: Record<string, string[]> = {
  free: [],
  writing: ['writing-buddy'],
  vocab: ['vocab-master'],
  bundle: ['writing-buddy', 'vocab-master'],
  family: ['writing-buddy', 'vocab-master'],
}

// --- Schemas ---

export const createSubscriptionSchema = z.object({
  userId: z.number().int().positive(),
  plan: z.enum(['free', 'writing', 'vocab', 'bundle', 'family']).default('free'),
  status: z.enum(['active', 'trial', 'expired', 'cancelled']).default('active'),
  features: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
  assignedBy: z.number().int().positive().optional(),
})

export const updateSubscriptionSchema = z.object({
  plan: z.enum(['free', 'writing', 'vocab', 'bundle', 'family']).optional(),
  status: z.enum(['active', 'trial', 'expired', 'cancelled']).optional(),
  features: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
})

export const listSubscriptionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  plan: z.enum(['free', 'writing', 'vocab', 'bundle', 'family']).optional(),
  status: z.enum(['active', 'trial', 'expired', 'cancelled']).optional(),
  userId: z.coerce.number().int().positive().optional(),
})

// --- Types ---

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>
export type ListSubscriptionsInput = z.infer<typeof listSubscriptionsSchema>

export interface Subscription {
  id: number
  user_id: number
  plan: string
  status: string
  features: string[]
  expires_at: Date | null
  assigned_by: number | null
  created_at: Date
  username?: string
  email?: string
}

export interface UserAppAccess {
  user_id: number
  app_id: number
  granted_at: Date
}

type Sql = postgres.Sql

// --- Pure functions ---

export function getFeatures(plan: string): string[] {
  return [...(PLAN_FEATURES[plan] ?? [])]
}

// --- Service functions ---

export async function createSubscription(
  sql: Sql,
  data: CreateSubscriptionInput,
): Promise<Subscription> {
  const validated = createSubscriptionSchema.parse(data)

  const features = validated.features ?? getFeatures(validated.plan)

  // Upsert: if user already has an active/trial subscription, update it
  // instead of creating a duplicate (partial unique index enforces this)
  const rows = await sql<Subscription[]>`
    INSERT INTO subscriptions (user_id, plan, status, features, expires_at, assigned_by)
    VALUES (
      ${validated.userId},
      ${validated.plan},
      ${validated.status},
      ${features},
      ${validated.expiresAt ?? null},
      ${validated.assignedBy ?? null}
    )
    ON CONFLICT (user_id) WHERE status IN ('active', 'trial')
    DO UPDATE SET
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      features = EXCLUDED.features,
      expires_at = EXCLUDED.expires_at,
      assigned_by = EXCLUDED.assigned_by
    RETURNING *
  `

  const subscription = rows[0]
  if (!subscription) {
    throw new AppError(500, 'Failed to create subscription')
  }

  // Auto-sync app access based on the assigned plan
  await syncAppAccessFromPlan(sql, validated.userId, validated.plan)

  logger.info('subscription created', {
    operation: 'createSubscription',
    subscriptionId: subscription.id,
    userId: validated.userId,
    plan: validated.plan,
  })

  return subscription
}

export async function findSubscriptionByUserId(
  sql: Sql,
  userId: number,
): Promise<Subscription | null> {
  const rows = await sql<Subscription[]>`
    SELECT * FROM subscriptions
    WHERE user_id = ${userId} AND status IN ('active', 'trial')
    ORDER BY created_at DESC
    LIMIT 1
  `

  return rows[0] ?? null
}

export async function findSubscriptionById(sql: Sql, id: number): Promise<Subscription | null> {
  const rows = await sql<Subscription[]>`
    SELECT * FROM subscriptions WHERE id = ${id}
  `

  return rows[0] ?? null
}

export async function updateSubscription(
  sql: Sql,
  id: number,
  data: UpdateSubscriptionInput,
): Promise<Subscription | null> {
  const validated = updateSubscriptionSchema.parse(data)

  const existing = await findSubscriptionById(sql, id)
  if (!existing) {
    return null
  }

  const plan = validated.plan ?? existing.plan
  const features = validated.features ?? (validated.plan ? getFeatures(plan) : existing.features)

  const updated = {
    plan,
    status: validated.status ?? existing.status,
    features,
    expires_at: validated.expiresAt !== undefined ? validated.expiresAt : existing.expires_at,
  }

  const rows = await sql<Subscription[]>`
    UPDATE subscriptions
    SET
      plan = ${updated.plan},
      status = ${updated.status},
      features = ${updated.features},
      expires_at = ${updated.expires_at}
    WHERE id = ${id}
    RETURNING *
  `

  const subscription = rows[0] ?? null

  // Re-sync app access when plan changes
  if (subscription && validated.plan) {
    await syncAppAccessFromPlan(sql, subscription.user_id, subscription.plan)
  }

  return subscription
}

export async function cancelSubscription(sql: Sql, id: number): Promise<Subscription | null> {
  const rows = await sql<Subscription[]>`
    UPDATE subscriptions
    SET status = 'cancelled'
    WHERE id = ${id}
    RETURNING *
  `

  const subscription = rows[0] ?? null
  if (subscription) {
    logger.info('subscription cancelled', {
      operation: 'cancelSubscription',
      subscriptionId: id,
      userId: subscription.user_id,
    })
  }

  return subscription
}

export async function listSubscriptions(
  sql: Sql,
  filters: ListSubscriptionsInput,
): Promise<Subscription[]> {
  const validated = listSubscriptionsSchema.parse(filters)
  const offset = (validated.page - 1) * validated.limit

  const hasPlan = validated.plan !== undefined
  const hasStatus = validated.status !== undefined
  const hasUserId = validated.userId !== undefined

  return sql<Subscription[]>`
    SELECT s.*, u.username, u.email
    FROM subscriptions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE 1=1
      ${hasPlan ? sql`AND s.plan = ${validated.plan!}` : sql``}
      ${hasStatus ? sql`AND s.status = ${validated.status!}` : sql``}
      ${hasUserId ? sql`AND s.user_id = ${validated.userId!}` : sql``}
    ORDER BY s.created_at DESC
    LIMIT ${validated.limit}
    OFFSET ${offset}
  `
}

export async function countSubscriptions(
  sql: Sql,
  filters: ListSubscriptionsInput,
): Promise<number> {
  const validated = listSubscriptionsSchema.parse(filters)

  const hasPlan = validated.plan !== undefined
  const hasStatus = validated.status !== undefined
  const hasUserId = validated.userId !== undefined

  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM subscriptions s
    WHERE 1=1
      ${hasPlan ? sql`AND s.plan = ${validated.plan!}` : sql``}
      ${hasStatus ? sql`AND s.status = ${validated.status!}` : sql``}
      ${hasUserId ? sql`AND s.user_id = ${validated.userId!}` : sql``}
  `

  return Number(rows[0]?.count ?? 0)
}

// --- App access functions ---

export async function grantAppAccess(
  sql: Sql,
  userId: number,
  appId: number,
): Promise<UserAppAccess> {
  const rows = await sql<UserAppAccess[]>`
    INSERT INTO user_app_access (user_id, app_id)
    VALUES (${userId}, ${appId})
    ON CONFLICT (user_id, app_id) DO NOTHING
    RETURNING *
  `

  const access = rows[0]
  if (!access) {
    // Already exists — fetch the existing row
    const existing = await sql<UserAppAccess[]>`
      SELECT * FROM user_app_access
      WHERE user_id = ${userId} AND app_id = ${appId}
    `
    const existingAccess = existing[0]
    if (!existingAccess) {
      throw new AppError(500, 'Failed to grant app access')
    }
    return existingAccess
  }

  logger.info('app access granted', {
    operation: 'grantAppAccess',
    userId,
    appId,
  })

  return access
}

export async function revokeAppAccess(sql: Sql, userId: number, appId: number): Promise<boolean> {
  const rows = await sql`
    DELETE FROM user_app_access
    WHERE user_id = ${userId} AND app_id = ${appId}
    RETURNING user_id
  `

  if (rows.length > 0) {
    logger.info('app access revoked', {
      operation: 'revokeAppAccess',
      userId,
      appId,
    })
  }

  return rows.length > 0
}

export async function getUserAppAccess(sql: Sql, userId: number): Promise<UserAppAccess[]> {
  return sql<UserAppAccess[]>`
    SELECT * FROM user_app_access
    WHERE user_id = ${userId}
    ORDER BY granted_at DESC
  `
}

export async function syncAppAccessFromPlan(sql: Sql, userId: number, plan: string): Promise<void> {
  const slugs = PLAN_APP_SLUGS[plan] ?? []

  // Remove all existing access
  await sql`
    DELETE FROM user_app_access WHERE user_id = ${userId}
  `

  // Grant access based on plan
  for (const slug of slugs) {
    const appRows = await sql<{ id: number }[]>`
      SELECT id FROM applications WHERE slug = ${slug}
    `
    const app = appRows[0]
    if (app) {
      await sql`
        INSERT INTO user_app_access (user_id, app_id)
        VALUES (${userId}, ${app.id})
        ON CONFLICT (user_id, app_id) DO NOTHING
      `
    }
  }
}

export async function checkEntitlement(
  sql: Sql,
  userId: number,
  appSlug: string,
): Promise<boolean> {
  const rows = await sql<{ user_id: number }[]>`
    SELECT uaa.user_id
    FROM user_app_access uaa
    JOIN applications a ON a.id = uaa.app_id
    WHERE uaa.user_id = ${userId} AND a.slug = ${appSlug}
  `

  return rows.length > 0
}
