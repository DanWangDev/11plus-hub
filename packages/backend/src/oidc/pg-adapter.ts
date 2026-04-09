import type postgres from 'postgres'
import type { Adapter, AdapterPayload } from 'oidc-provider'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-pg-adapter' })

type ModelName = string

interface DbApplication {
  client_id: string
  client_secret_sha256: string | null
  redirect_uris: string[]
  name: string
  slug: string
  url: string
  backchannel_logout_uri: string | null
  status: string
}

interface CacheEntry {
  payload: AdapterPayload | undefined
  cachedAt: number
}

const CLIENT_CACHE_TTL_MS = 60_000 // 60 seconds
const clientCache = new Map<string, CacheEntry>()

function mapAppToClientPayload(app: DbApplication): AdapterPayload {
  const isConfidential = app.client_secret_sha256 !== null
  const origins = app.redirect_uris
    .map((uri) => {
      try {
        return new URL(uri).origin
      } catch {
        return null
      }
    })
    .filter((origin): origin is string => origin !== null && origin !== app.url)

  return {
    client_id: app.client_id,
    ...(isConfidential ? { client_secret: app.client_secret_sha256! } : {}),
    redirect_uris: app.redirect_uris,
    client_name: app.name,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: isConfidential ? 'client_secret_post' : 'none',
    scope: 'openid profile email hub',
    post_logout_redirect_uris: [app.url, ...origins],
    ...(app.backchannel_logout_uri ? { backchannel_logout_uri: app.backchannel_logout_uri } : {}),
  }
}

function createClientAdapter(sql: postgres.Sql): Adapter {
  return {
    async find(id: string): Promise<AdapterPayload | undefined> {
      const now = Date.now()
      const cached = clientCache.get(id)
      if (cached && now - cached.cachedAt < CLIENT_CACHE_TTL_MS) {
        return cached.payload
      }

      const rows = await sql<DbApplication[]>`
        SELECT client_id, client_secret_sha256, redirect_uris, name, slug, url, backchannel_logout_uri, status
        FROM applications
        WHERE client_id = ${id} AND status = 'active'
      `

      const app = rows[0]
      const payload = app ? mapAppToClientPayload(app) : undefined

      clientCache.set(id, { payload, cachedAt: now })

      if (payload) {
        logger.info('oidc client loaded dynamically', { operation: 'clientFind', clientId: id })
      }

      return payload
    },

    // Client model is read-only — these are no-ops
    async upsert(): Promise<void> {},
    async findByUserCode(): Promise<AdapterPayload | undefined> {
      return undefined
    },
    async findByUid(): Promise<AdapterPayload | undefined> {
      return undefined
    },
    async consume(): Promise<void> {},
    async destroy(): Promise<void> {},
    async revokeByGrantId(): Promise<void> {},
  }
}

/** Clear the client cache (useful after secret rotation or app updates) */
export function clearClientCache(): void {
  clientCache.clear()
}

export function createPgAdapter(sql: postgres.Sql) {
  return function PgAdapter(name: ModelName): Adapter {
    // Client model queries the applications table dynamically
    if (name === 'Client') {
      return createClientAdapter(sql)
    }

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
