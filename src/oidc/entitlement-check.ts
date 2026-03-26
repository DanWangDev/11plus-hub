import type postgres from 'postgres'
import { checkEntitlement } from '../services/subscription-service.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-entitlement' })

interface EntitlementResult {
  allowed: boolean
  appName?: string
  reason?: string
}

/** The hub's own client_id — all users can log into the hub itself */
const HUB_CLIENT_ID = 'hub'

/**
 * Check whether a user is entitled to access the application identified by client_id.
 * Called during the OIDC interaction flow after successful authentication.
 *
 * The hub itself is always accessible — it's the identity provider, not a gated app.
 */
export async function checkUserEntitlement(
  sql: postgres.Sql,
  userId: number,
  clientId: string,
): Promise<EntitlementResult> {
  // The hub is the identity provider — everyone can log into it
  if (clientId === HUB_CLIENT_ID) {
    return { allowed: true, appName: 'Hub' }
  }

  // Look up the application by client_id to get its slug and name
  const apps = await sql<{ slug: string; name: string }[]>`
    SELECT slug, name FROM applications WHERE client_id = ${clientId} AND status = 'active'
  `

  const app = apps[0]
  if (!app) {
    logger.warn('entitlement check: unknown client_id', {
      operation: 'checkEntitlement',
      userId,
      clientId,
    })
    return { allowed: false, reason: 'unknown_client' }
  }

  const entitled = await checkEntitlement(sql, userId, app.slug)

  if (!entitled) {
    logger.info('entitlement denied', {
      operation: 'checkEntitlement',
      userId,
      clientId,
      appSlug: app.slug,
    })
    return { allowed: false, appName: app.name, reason: 'no_entitlement' }
  }

  logger.info('entitlement granted', {
    operation: 'checkEntitlement',
    userId,
    clientId,
    appSlug: app.slug,
  })

  return { allowed: true, appName: app.name }
}
