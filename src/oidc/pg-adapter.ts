import type postgres from 'postgres'
import type { Adapter, AdapterPayload } from 'oidc-provider'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-pg-adapter' })

type ModelName = string

export function createPgAdapter(sql: postgres.Sql) {
  return function PgAdapter(name: ModelName): Adapter {
    const type = name.toLowerCase()

    return {
      async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
        const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null

        await sql`
          INSERT INTO oidc_payloads (id, type, payload, grant_id, user_code, uid, expires_at)
          VALUES (
            ${id},
            ${type},
            ${sql.json(JSON.parse(JSON.stringify(payload)))},
            ${payload.grantId ?? null},
            ${payload.userCode ?? null},
            ${payload.uid ?? null},
            ${expiresAt}
          )
          ON CONFLICT (id, type) DO UPDATE SET
            payload = ${sql.json(JSON.parse(JSON.stringify(payload)))},
            grant_id = ${payload.grantId ?? null},
            user_code = ${payload.userCode ?? null},
            uid = ${payload.uid ?? null},
            expires_at = ${expiresAt}
        `

        logger.info('oidc payload upserted', { operation: 'upsert', type, id })
      },

      async find(id: string): Promise<AdapterPayload | undefined> {
        const rows = await sql<{ payload: AdapterPayload; consumed_at: Date | null }[]>`
          SELECT payload, consumed_at FROM oidc_payloads
          WHERE id = ${id} AND type = ${type}
        `

        const row = rows[0]
        if (!row) {
          return undefined
        }

        const result = row.payload
        if (row.consumed_at) {
          result.consumed = true
        }

        return result
      },

      async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
        const rows = await sql<{ payload: AdapterPayload; consumed_at: Date | null }[]>`
          SELECT payload, consumed_at FROM oidc_payloads
          WHERE user_code = ${userCode} AND type = ${type}
        `

        const row = rows[0]
        if (!row) {
          return undefined
        }

        const result = row.payload
        if (row.consumed_at) {
          result.consumed = true
        }

        return result
      },

      async findByUid(uid: string): Promise<AdapterPayload | undefined> {
        const rows = await sql<{ payload: AdapterPayload; consumed_at: Date | null }[]>`
          SELECT payload, consumed_at FROM oidc_payloads
          WHERE uid = ${uid} AND type = ${type}
        `

        const row = rows[0]
        if (!row) {
          return undefined
        }

        const result = row.payload
        if (row.consumed_at) {
          result.consumed = true
        }

        return result
      },

      async consume(id: string): Promise<void> {
        await sql`
          UPDATE oidc_payloads
          SET consumed_at = now()
          WHERE id = ${id} AND type = ${type}
        `

        logger.info('oidc payload consumed', { operation: 'consume', type, id })
      },

      async destroy(id: string): Promise<void> {
        await sql`
          DELETE FROM oidc_payloads
          WHERE id = ${id} AND type = ${type}
        `

        logger.info('oidc payload destroyed', { operation: 'destroy', type, id })
      },

      async revokeByGrantId(grantId: string): Promise<void> {
        await sql`
          DELETE FROM oidc_payloads
          WHERE grant_id = ${grantId}
        `

        logger.info('oidc payloads revoked by grant', {
          operation: 'revokeByGrantId',
          type,
          grantId,
        })
      },
    }
  }
}
