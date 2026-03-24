import type postgres from 'postgres'
import type { ClientMetadata } from 'oidc-provider'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-client-loader' })

interface DbApplication {
  client_id: string
  client_secret_hash: string
  redirect_uris: string[]
  name: string
  slug: string
  url: string
}

export async function loadClientsFromDb(sql: postgres.Sql): Promise<ClientMetadata[]> {
  const apps = await sql<DbApplication[]>`
    SELECT client_id, client_secret_hash, redirect_uris, name, slug, url
    FROM applications
    WHERE status = 'active' OR status IS NULL
  `

  const clients = apps.map(
    (app): ClientMetadata => ({
      client_id: app.client_id,
      client_secret: app.client_secret_hash,
      redirect_uris: app.redirect_uris,
      client_name: app.name,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
      scope: 'openid profile email hub',
      post_logout_redirect_uris: [app.url],
    }),
  )

  logger.info('oidc clients loaded from db', {
    operation: 'loadClients',
    count: clients.length,
    clientIds: clients.map((c) => c.client_id),
  })

  return clients
}
