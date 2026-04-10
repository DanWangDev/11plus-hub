import type postgres from 'postgres'
import { SignJWT, importJWK } from 'jose'
import { randomUUID } from 'crypto'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'bcl-retry' })

const BACKOFF_SCHEDULE_SECONDS = [5, 15, 45, 135, 405]
const MAX_ATTEMPTS = 5
const RETRY_INTERVAL_MS = 10_000
const BCL_REQUEST_TIMEOUT_MS = 5_000

export async function queueBclRetry(
  sql: postgres.Sql,
  sub: string,
  sid: string,
  clientId: string,
): Promise<void> {
  const nextAt = new Date(Date.now() + BACKOFF_SCHEDULE_SECONDS[0]! * 1000)
  await sql`
    INSERT INTO bcl_retry_queue (sub, sid, client_id, next_at)
    VALUES (${sub}, ${sid}, ${clientId}, ${nextAt})
  `
  logger.info('bcl retry queued', {
    operation: 'queueBclRetry',
    clientId,
    sub,
    nextAt: nextAt.toISOString(),
  })
}

export async function generateLogoutToken(
  issuer: string,
  signingKey: string,
  sub: string,
  sid: string,
  clientId: string,
): Promise<string> {
  const jwk = JSON.parse(signingKey)
  const key = await importJWK(jwk, 'RS256')

  return new SignJWT({
    events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
    sid,
  })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'logout+jwt' })
    .setIssuer(issuer)
    .setSubject(sub)
    .setAudience(clientId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(key)
}

interface PendingEntry {
  id: number
  sub: string
  sid: string
  client_id: string
  attempts: number
}

interface AppRow {
  backchannel_logout_uri: string | null
}

export async function retryPendingBcl(
  sql: postgres.Sql,
  issuer: string,
  signingKey: string,
): Promise<void> {
  const pending = await sql<PendingEntry[]>`
    SELECT id, sub, sid, client_id, attempts
    FROM bcl_retry_queue
    WHERE status = 'pending' AND next_at <= now()
    ORDER BY next_at
    LIMIT 50
  `

  for (const entry of pending) {
    try {
      const [app] = await sql<AppRow[]>`
        SELECT backchannel_logout_uri
        FROM applications
        WHERE client_id = ${entry.client_id} AND status = 'active'
      `

      if (!app?.backchannel_logout_uri) {
        await sql`DELETE FROM bcl_retry_queue WHERE id = ${entry.id}`
        logger.warn('bcl retry skipped: no logout URI', {
          operation: 'retryBcl',
          clientId: entry.client_id,
          id: entry.id,
        })
        continue
      }

      const logoutToken = await generateLogoutToken(
        issuer,
        signingKey,
        entry.sub,
        entry.sid,
        entry.client_id,
      )

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), BCL_REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(app.backchannel_logout_uri, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ logout_token: logoutToken }),
          signal: controller.signal,
        })

        if (response.status === 200 || response.status === 204) {
          await sql`DELETE FROM bcl_retry_queue WHERE id = ${entry.id}`
          logger.info('bcl retry succeeded', {
            operation: 'retryBcl',
            clientId: entry.client_id,
            attempt: entry.attempts + 1,
            id: entry.id,
          })
          continue
        }

        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      const nextAttempt = entry.attempts + 1
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (nextAttempt >= MAX_ATTEMPTS) {
        await sql`
          UPDATE bcl_retry_queue
          SET status = 'failed',
              attempts = ${nextAttempt},
              last_error = ${errorMessage},
              updated_at = now()
          WHERE id = ${entry.id}
        `
        logger.error('bcl retry exhausted', {
          operation: 'retryBcl',
          clientId: entry.client_id,
          attempts: nextAttempt,
          error: errorMessage,
          id: entry.id,
        })
      } else {
        const delaySec = BACKOFF_SCHEDULE_SECONDS[nextAttempt]!
        const nextAt = new Date(Date.now() + delaySec * 1000)
        await sql`
          UPDATE bcl_retry_queue
          SET attempts = ${nextAttempt},
              next_at = ${nextAt},
              last_error = ${errorMessage},
              updated_at = now()
          WHERE id = ${entry.id}
        `
        logger.warn('bcl retry failed, will retry', {
          operation: 'retryBcl',
          clientId: entry.client_id,
          attempt: nextAttempt,
          nextAt: nextAt.toISOString(),
          error: errorMessage,
          id: entry.id,
        })
      }
    }
  }
}

export function startBclRetryJob(
  sql: postgres.Sql,
  issuer: string,
  signingKey: string,
): NodeJS.Timeout {
  async function tick(): Promise<void> {
    try {
      await retryPendingBcl(sql, issuer, signingKey)
    } catch (error) {
      logger.error('bcl retry job tick failed', {
        operation: 'retryBclTick',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  tick()
  return setInterval(tick, RETRY_INTERVAL_MS)
}
