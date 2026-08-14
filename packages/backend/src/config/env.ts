import { z } from 'zod'

// Development defaults. In production these are FORBIDDEN — loadEnv() throws
// unless every one of them is explicitly overridden (see below).
const DEV_DB_PASSWORD = 'hub_dev_password'
const DEV_OIDC_COOKIE_KEYS = 'dev-oidc-cookie-key-minimum-32-characters!!'
const DEV_HUB_CLIENT_SECRET = 'hub-dev-client-secret'
const DEV_HUB_SESSION_SECRET = 'hub-session-secret-minimum-32-characters-long!!'

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3009),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('hub'),
  DB_USER: z.string().default('hub'),
  DB_PASSWORD: z.string().default(DEV_DB_PASSWORD),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  OIDC_ISSUER: z.string().url().default('http://localhost:3009'),
  OIDC_INTERNAL_ISSUER: z.string().optional(),
  OIDC_SIGNING_KEY: z.string().optional(),
  OIDC_COOKIE_KEYS: z.string().default(DEV_OIDC_COOKIE_KEYS),

  // Hub as its own OIDC client (self-client for SSO)
  HUB_CLIENT_ID: z.string().default('hub'),
  HUB_CLIENT_SECRET: z.string().default(DEV_HUB_CLIENT_SECRET),
  HUB_SESSION_SECRET: z.string().min(32).default(DEV_HUB_SESSION_SECRET),

  GOOGLE_CLIENT_ID: z.string().optional(),

  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),

  // Stripe billing (optional — disabled when not configured)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),

  // Email (optional — password reset emails disabled when not configured)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('11+ Hub <no-reply@labf.app>'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Demo data seeding (demo users + dev app registrations). Off by default;
  // the dev docker-compose sets it to true. Never enable in production.
  SEED_ON_STARTUP: z.coerce.boolean().default(false),
})

export type Env = z.infer<typeof envSchema>

/**
 * Secrets that MUST be explicitly configured in production. Running prod with
 * the development defaults (or without the value at all) would expose
 * publicly-known session-encryption keys and OIDC signing keys — fail fast
 * instead. `devDefault` is '' when the field has no default (required-in-prod only).
 */
const PRODUCTION_REQUIRED_SECRETS: ReadonlyArray<readonly [string, string]> = [
  ['HUB_SESSION_SECRET', DEV_HUB_SESSION_SECRET],
  ['OIDC_COOKIE_KEYS', DEV_OIDC_COOKIE_KEYS],
  ['HUB_CLIENT_SECRET', DEV_HUB_CLIENT_SECRET],
  ['DB_PASSWORD', DEV_DB_PASSWORD],
  ['OIDC_SIGNING_KEY', ''],
]

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const formatted = result.error.format()
    const message = Object.entries(formatted)
      .filter(([key]) => key !== '_errors')
      .map(([key, val]) => {
        const errors = (val as { _errors?: string[] })._errors
        return `  ${key}: ${errors?.join(', ') ?? 'unknown error'}`
      })
      .join('\n')

    throw new Error(`Invalid environment variables:\n${message}`)
  }

  const env = result.data

  if (env.NODE_ENV === 'production') {
    const problems: string[] = []
    for (const [name, devDefault] of PRODUCTION_REQUIRED_SECRETS) {
      const raw = source[name]
      if (raw === undefined || raw === '') {
        problems.push(`${name}: must be set explicitly in production`)
      } else if (devDefault !== '' && raw === devDefault) {
        problems.push(`${name}: must not use the development default value in production`)
      }
    }

    if (problems.length > 0) {
      throw new Error(`Invalid environment variables:\n${problems.map((p) => `  ${p}`).join('\n')}`)
    }
  }

  return env
}

export const env = loadEnv()
