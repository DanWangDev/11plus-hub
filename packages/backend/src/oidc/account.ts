import type postgres from 'postgres'
import { findUserById, hasPassword } from '../services/user-service.js'
import {
  findSubscriptionByUserId,
  getUserAppAccess,
  syncAppAccessFromPlan,
  PLAN_APP_SLUGS,
} from '../services/subscription-service.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-account' })

export interface OidcAccount {
  accountId: string
  claims: () => Promise<Record<string, unknown>>
}

export function createAccountFinder(sql: postgres.Sql) {
  return async function findAccount(_ctx: unknown, sub: string): Promise<OidcAccount | undefined> {
    const userId = Number(sub)
    if (Number.isNaN(userId)) {
      logger.warn('invalid sub for account lookup', { sub })
      return undefined
    }

    const user = await findUserById(sql, userId)
    if (!user) {
      logger.warn('user not found for account lookup', { sub })
      return undefined
    }

    return {
      accountId: String(user.id),
      claims: async () => {
        const subscription = await findSubscriptionByUserId(sql, user.id)
        const plan = subscription?.plan ?? 'free'

        // Derive expected apps from the plan (source of truth)
        const expectedApps = PLAN_APP_SLUGS[plan] ?? []

        // Check actual app access — if out of sync, repair it
        const appAccess = await getUserAppAccess(sql, user.id)
        const appIds = appAccess.map((a) => a.app_id)
        let appSlugs: string[] = []
        if (appIds.length > 0) {
          const apps = await sql<{ slug: string }[]>`
            SELECT slug FROM applications WHERE id = ANY(${appIds})
          `
          appSlugs = apps.map((a) => a.slug)
        }

        // Auto-sync if user_app_access is stale (missing or extra apps)
        const missing = expectedApps.filter((slug) => !appSlugs.includes(slug))
        const extra = appSlugs.filter((slug) => !expectedApps.includes(slug))
        if (missing.length > 0 || extra.length > 0) {
          logger.info('auto-syncing stale user_app_access', {
            operation: 'claims',
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
          operation: 'claims',
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
          expires_at: subscription?.expires_at
            ? new Date(subscription.expires_at).toISOString()
            : null,
        }
      },
    }
  }
}
