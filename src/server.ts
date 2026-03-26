import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { createDb } from './db/connection.js'
import { createOidcProvider } from './oidc/provider.js'
import { createAccountFinder } from './oidc/account.js'
import { generateDevSigningKey } from './oidc/dev-keys.js'
import { createLogger } from './lib/logger.js'

const logger = createLogger({ service: 'server' })

async function main(): Promise<void> {
  const sql = createDb()

  const signingKey = env.OIDC_SIGNING_KEY ?? (await generateDevSigningKey())
  const cookieKeys = env.OIDC_COOKIE_KEYS.split(',')

  const oidcProvider = createOidcProvider({
    issuer: env.OIDC_ISSUER,
    sql,
    signingKey,
    cookieKeys,
    findAccount: createAccountFinder(sql),
  })

  const __dirname = fileURLToPath(new URL('.', import.meta.url))
  const frontendDist = resolve(__dirname, '..', 'packages', 'frontend', 'dist')
  const frontendDir = existsSync(frontendDist) ? frontendDist : undefined

  const app = createApp({
    sql,
    oidcProvider,
    frontendDir,
    hubAuth: {
      issuer: env.OIDC_ISSUER,
      clientId: env.HUB_CLIENT_ID,
      clientSecret: env.HUB_CLIENT_SECRET,
      sessionSecret: env.HUB_SESSION_SECRET,
      redirectUri: `${env.OIDC_ISSUER}/auth/callback`,
    },
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
