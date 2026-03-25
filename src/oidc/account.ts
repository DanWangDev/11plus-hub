import type postgres from 'postgres'
import { findUserById } from '../services/user-service.js'
import { findSubscriptionByUserId } from '../services/subscription-service.js'
import { getUserAppAccess } from '../services/subscription-service.js'
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
        const appAccess = await getUserAppAccess(sql, user.id)

        const appIds = appAccess.map((a) => a.app_id)

        // Fetch app slugs for the access entries
        let appSlugs: string[] = []
        if (appIds.length > 0) {
          const apps = await sql<{ slug: string }[]>`
            SELECT slug FROM applications WHERE id = ANY(${appIds})
          `
          appSlugs = apps.map((a) => a.slug)
        }

        logger.info('oidc claims generated', {
          operation: 'claims',
          userId: user.id,
          plan: subscription?.plan ?? 'free',
          appCount: appSlugs.length,
        })

        return {
          sub: String(user.id),
          username: user.username,
          display_name: user.display_name,
          email: user.email,
          email_verified: user.email_verified,
          role: user.role,
          plan: subscription?.plan ?? 'free',
          features: subscription?.features ?? [],
          apps: appSlugs,
          expires_at: subscription?.expires_at
            ? new Date(subscription.expires_at).toISOString()
            : null,
        }
      },
    }
  }
}
