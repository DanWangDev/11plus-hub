import type postgres from 'postgres'
import { findUserById } from '../services/user-service.js'
import { buildUserClaims } from './user-claims.js'
import { getHubSession } from '../lib/session.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-account' })

interface ImpersonationData {
  targetUserId: number
  claims: Record<string, unknown>
  impersonatedBy: {
    adminUserId: number
    adminUsername: string
    startedAt: string
  }
}

interface HubSessionData {
  tokens?: { id_token?: string; access_token?: string; refresh_token?: string }
  impersonation?: ImpersonationData
}

export interface OidcAccount {
  accountId: string
  claims: () => Promise<Record<string, unknown>>
}

export function createAccountFinder(sql: postgres.Sql, sessionSecret?: string) {
  return async function findAccount(ctx: unknown, sub: string): Promise<OidcAccount | undefined> {
    // During impersonation, swap to the target user's identity.
    // The hub's iron-session cookie is separate from the OIDC provider session.
    // When an admin impersonates and clicks an app link, the OIDC provider
    // calls findAccount with the admin's sub — we intercept and return
    // the impersonated user's claims instead.
    if (sessionSecret) {
      try {
        const koaCtx = ctx as { req: unknown; res: unknown }
        if (koaCtx.req && koaCtx.res) {
          const session = await getHubSession<HubSessionData>(
            koaCtx.req as never,
            koaCtx.res as never,
            sessionSecret,
          )

          if (session.impersonation) {
            const imp = session.impersonation
            logger.info('oidc claims: impersonation active, swapping identity', {
              operation: 'claims',
              adminUserId: imp.impersonatedBy.adminUserId,
              targetUserId: imp.targetUserId,
            })

            return {
              accountId: String(imp.targetUserId),
              claims: async () => ({
                ...imp.claims,
                impersonated_by: imp.impersonatedBy,
              }),
            }
          }
        }
      } catch {
        // Cookie missing, invalid, or wrong secret — fall through to normal flow
      }
    }

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
      claims: async () => buildUserClaims(sql, user.id, 'claims'),
    }
  }
}
