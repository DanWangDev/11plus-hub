import type postgres from 'postgres'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'registry-cors' })

interface RegistryAppRow {
  url: string | null
  redirect_uris: string[] | null
}

/**
 * Build the CORS origin allowlist from the application registry: every
 * origin that appears in an active app's `url` or `redirect_uris`.
 *
 * This replaces the previous wildcard (`any *.labf.app subdomain`), which —
 * combined with credentialed cookies scoped to .labf.app — let any subdomain
 * make authenticated API calls as the logged-in user.
 */
export async function loadCorsOriginsFromRegistry(sql: postgres.Sql): Promise<string[]> {
  const origins = new Set<string>()

  try {
    const rows = await sql<RegistryAppRow[]>`
      SELECT url, redirect_uris FROM applications WHERE status = 'active'
    `

    for (const row of rows) {
      for (const uri of [row.url, ...(row.redirect_uris ?? [])]) {
        if (!uri) continue
        try {
          origins.add(new URL(uri).origin)
        } catch {
          // Skip malformed URIs — they can't be valid CORS origins anyway.
        }
      }
    }
  } catch (error) {
    // Never crash the boot for CORS metadata; the hub origin alone still works.
    logger.error('failed to load CORS origins from application registry', {
      operation: 'loadCorsOrigins',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  logger.info('cors allowlist loaded', {
    operation: 'loadCorsOrigins',
    origins: [...origins],
  })

  return [...origins]
}
