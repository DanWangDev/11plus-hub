import { createApp } from './app.js'
import { env } from './config/env.js'
import { createDb } from './db/connection.js'
import { createOidcProvider } from './oidc/provider.js'
import { createAccountFinder } from './oidc/account.js'
import { generateDevSigningKey } from './oidc/dev-keys.js'
import { startOidcPayloadCleanup } from './jobs/oidc-cleanup.js'
import { startBclRetryJob } from './oidc/bcl-retry.js'
import { createStripeClient } from './services/stripe-service.js'
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

  // Stripe billing (optional — disabled when env vars not set)
  const stripeEnabled = env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ID
  const stripe = stripeEnabled ? createStripeClient(env.STRIPE_SECRET_KEY!) : undefined

  const app = createApp({
    sql,
    oidcProvider,
    hubAuth: {
      issuer: env.OIDC_ISSUER,
      clientId: env.HUB_CLIENT_ID,
      clientSecret: env.HUB_CLIENT_SECRET,
      sessionSecret: env.HUB_SESSION_SECRET,
      redirectUri: `${env.OIDC_ISSUER}/api/auth/hub-callback`,
    },
    stripeWebhook: stripe ? { stripe, sql, webhookSecret: env.STRIPE_WEBHOOK_SECRET! } : undefined,
    stripeCheckout: stripe
      ? { stripe, sql, priceId: env.STRIPE_PRICE_ID!, hubOrigin: env.OIDC_ISSUER }
      : undefined,
  })

  // Clean up expired OIDC payloads hourly
  startOidcPayloadCleanup(sql)

  // Retry failed backchannel logout notifications with exponential backoff
  startBclRetryJob(sql, env.OIDC_ISSUER, signingKey)

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
