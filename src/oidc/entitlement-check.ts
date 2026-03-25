import type postgres from 'postgres'
import { checkEntitlement } from '../services/subscription-service.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-entitlement' })

interface EntitlementResult {
  allowed: boolean
  appName?: string
  reason?: string
}

/**
 * Check whether a user is entitled to access the application identified by client_id.
 * Called during the OIDC interaction flow after successful authentication.
 */
export async function checkUserEntitlement(
  sql: postgres.Sql,
  userId: number,
  clientId: string,
): Promise<EntitlementResult> {
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
