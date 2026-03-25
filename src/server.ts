import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { createDb } from './db/connection.js'
import { createOidcProvider } from './oidc/provider.js'
import { createAccountFinder } from './oidc/account.js'
import { loadClientsFromDb } from './oidc/client-loader.js'
import { generateDevSigningKey } from './oidc/dev-keys.js'
import { createLogger } from './lib/logger.js'

const logger = createLogger({ service: 'server' })

async function main(): Promise<void> {
  const sql = createDb()

  const signingKey = env.OIDC_SIGNING_KEY ?? (await generateDevSigningKey())
  const cookieKeys = env.OIDC_COOKIE_KEYS.split(',')

  // Load registered applications as OIDC clients
  const clients = await loadClientsFromDb(sql)

  const oidcProvider = createOidcProvider({
    issuer: env.OIDC_ISSUER,
    sql,
    signingKey,
    cookieKeys,
    clients,
    findAccount: createAccountFinder(sql),
  })

  const __dirname = fileURLToPath(new URL('.', import.meta.url))
  const frontendDist = resolve(__dirname, '..', 'packages', 'frontend', 'dist')
  const frontendDir = existsSync(frontendDist) ? frontendDist : undefined

  const app = createApp({
    sql,
    oidcProvider,
    frontendDir,
  })

  app.listen(env.PORT, env.HOST, () => {
    logger.info('hub server started', {
      host: env.HOST,
      port: env.PORT,
      env: env.NODE_ENV,
      issuer: env.OIDC_ISSUER,
    })
  })
}

main().catch((err) => {
  logger.error('server startup failed', {
    error: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
