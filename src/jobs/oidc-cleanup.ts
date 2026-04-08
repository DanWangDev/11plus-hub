import type postgres from 'postgres'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-cleanup' })

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Periodically deletes expired OIDC payloads (tokens, codes, sessions)
 * from the oidc_payloads table to prevent unbounded growth.
 */
export function startOidcPayloadCleanup(sql: postgres.Sql): NodeJS.Timeout {
  async function cleanup(): Promise<void> {
    try {
      const result = await sql`
        DELETE FROM oidc_payloads
        WHERE expires_at IS NOT NULL AND expires_at < now()
      `
      const count = result.count
      if (count > 0) {
        logger.info('oidc payload cleanup completed', {
          operation: 'oidcCleanup',
          deletedCount: count,
        })
      }

      const bclResult = await sql`
        DELETE FROM bcl_retry_queue
        WHERE status = 'failed' AND updated_at < now() - interval '1 hour'
      `
      const bclCount = bclResult.count
      if (bclCount > 0) {
        logger.info('bcl retry queue cleanup completed', {
          operation: 'bclCleanup',
          deletedCount: bclCount,
        })
      }
    } catch (error) {
      logger.error('oidc payload cleanup failed', {
        operation: 'oidcCleanup',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Run once at startup, then on interval
  cleanup()
  return setInterval(cleanup, CLEANUP_INTERVAL_MS)
}
