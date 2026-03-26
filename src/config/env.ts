import { z } from 'zod'

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3009),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('hub'),
  DB_USER: z.string().default('hub'),
  DB_PASSWORD: z.string().default('hub_dev_password'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32).default('dev-session-secret-minimum-32-characters-long!!'),

  OIDC_ISSUER: z.string().url().default('http://localhost:3009'),
  OIDC_SIGNING_KEY: z.string().optional(),
  OIDC_COOKIE_KEYS: z.string().default('dev-oidc-cookie-key-minimum-32-characters!!'),

  // Hub as its own OIDC client (self-client for SSO)
  HUB_CLIENT_ID: z.string().default('hub'),
  HUB_CLIENT_SECRET: z.string().default('hub-dev-client-secret'),
  HUB_SESSION_SECRET: z
    .string()
    .min(32)
    .default('hub-session-secret-minimum-32-characters-long!!'),

  GOOGLE_CLIENT_ID: z.string().optional(),

  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export type Env = z.infer<typeof envSchema>

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
  return result.data
}

export const env = loadEnv()
