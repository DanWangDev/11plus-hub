import { createHash, timingSafeEqual } from 'crypto'
import type postgres from 'postgres'
import type { ClientMetadata } from 'oidc-provider'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-client-loader' })

interface DbApplication {
  client_id: string
  client_secret_sha256: string | null
  redirect_uris: string[]
  name: string
  slug: string
  url: string
  backchannel_logout_uri: string | null
}

function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Verify a plaintext client secret against a stored SHA-256 hash.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyClientSecret(plaintext: string, storedSha256: string): boolean {
  const incoming = hashSha256(plaintext)
  if (incoming.length !== storedSha256.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(incoming), Buffer.from(storedSha256))
}

export async function loadClientsFromDb(sql: postgres.Sql): Promise<ClientMetadata[]> {
  const apps = await sql<DbApplication[]>`
    SELECT client_id, client_secret_sha256, redirect_uris, name, slug, url, backchannel_logout_uri
    FROM applications
    WHERE status = 'active'
  `

  const clients = apps.map((app): ClientMetadata => {
    const isConfidential = app.client_secret_sha256 !== null

    return {
      client_id: app.client_id,
      // oidc-provider compares client_secret by string equality.
      // We store the SHA-256 hash as client_secret, and our token endpoint
      // middleware (see oidc/secret-auth-middleware.ts) hashes the incoming
      // plaintext secret before oidc-provider sees it. This gives us the
      // IdentityServer pattern: hash-at-rest, fast comparison.
      ...(isConfidential ? { client_secret: app.client_secret_sha256! } : {}),
      redirect_uris: app.redirect_uris,
      client_name: app.name,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: isConfidential ? 'client_secret_post' : 'none',
      scope: 'openid profile email hub',
      post_logout_redirect_uris: [
        app.url,
        ...app.redirect_uris
          .map((uri) => {
            try {
              const u = new URL(uri)
              return u.origin
            } catch {
              return null
            }
          })
          .filter((origin): origin is string => origin !== null && origin !== app.url),
      ],
      ...(app.backchannel_logout_uri ? { backchannel_logout_uri: app.backchannel_logout_uri } : {}),
    }
  })

  logger.info('oidc clients loaded from db', {
    operation: 'loadClients',
    count: clients.length,
    clientIds: clients.map((c) => c.client_id),
  })

  return clients
}
