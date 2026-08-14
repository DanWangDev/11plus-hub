import type postgres from 'postgres'
import { findUserById, hasPassword } from '../services/user-service.js'
import {
  findSubscriptionByUserId,
  getUserAppAccess,
  syncAppAccessFromPlan,
  PLAN_APP_SLUGS,
} from '../services/subscription-service.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-user-claims' })

/**
 * Assemble the OIDC claims for a user: identity fields plus plan,
 * features, apps, has_password, and expires_at. Also self-heals
 * `user_app_access` when it has drifted from the user's plan.
 *
 * This is THE single claims assembly — used by the OIDC account finder
 * (every token issuance) and by impersonation (admin sessions), so both
 * paths always agree on the claim shape.
 */
export async function buildUserClaims(
  sql: postgres.Sql,
  userId: number,
  operation: string,
): Promise<Record<string, unknown>> {
  const user = await findUserById(sql, userId)
  if (!user) {
    throw new Error('User not found')
  }

  const subscription = await findSubscriptionByUserId(sql, user.id)
  const plan = subscription?.plan ?? 'free'
  const expectedApps = PLAN_APP_SLUGS[plan] ?? []

  const appAccess = await getUserAppAccess(sql, user.id)
  const appIds = appAccess.map((a) => a.app_id)
  let appSlugs: string[] = []
  if (appIds.length > 0) {
    const apps = await sql<{ slug: string }[]>`
      SELECT slug FROM applications WHERE id = ANY(${appIds})
    `
    appSlugs = apps.map((a) => a.slug)
  }

  // Auto-sync stale access (missing or extra apps)
  const missing = expectedApps.filter((slug) => !appSlugs.includes(slug))
  const extra = appSlugs.filter((slug) => !expectedApps.includes(slug))
  if (missing.length > 0 || extra.length > 0) {
    logger.info('auto-syncing stale user_app_access', {
      operation,
      userId: user.id,
      plan,
      missing,
      extra,
    })
    await syncAppAccessFromPlan(sql, user.id, plan)
    appSlugs = expectedApps
  }

  const userHasPassword = await hasPassword(sql, user.id)

  logger.info('oidc claims generated', {
    operation,
    userId: user.id,
    plan,
    appCount: appSlugs.length,
  })

  return {
    sub: String(user.id),
    username: user.username,
    display_name: user.display_name,
    email: user.email,
    email_verified: user.email_verified,
    role: user.role,
    plan,
    features: subscription?.features ?? [],
    apps: appSlugs,
    has_password: userHasPassword,
    expires_at: subscription?.expires_at ? new Date(subscription.expires_at).toISOString() : null,
  }
}
