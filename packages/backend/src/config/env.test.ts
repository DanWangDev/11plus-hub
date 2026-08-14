import { describe, it, expect } from 'vitest'
import { envSchema, loadEnv } from './env.js'

const VALID_PROD_SECRETS = {
  HUB_SESSION_SECRET: 'prod-hub-session-secret-at-least-32-chars!!',
  OIDC_COOKIE_KEYS: 'prod-oidc-cookie-key-at-least-32-chars!!',
  HUB_CLIENT_SECRET: 'prod-hub-client-secret',
  DB_PASSWORD: 'prod-db-password',
  OIDC_SIGNING_KEY: '{"kid":"prod","use":"sig","alg":"RS256"}',
}

describe('envSchema', () => {
  it('uses defaults when no env vars are set', () => {
    const result = envSchema.parse({})
    expect(result.NODE_ENV).toBe('development')
    expect(result.PORT).toBe(3009)
    expect(result.HOST).toBe('0.0.0.0')
    expect(result.DB_HOST).toBe('localhost')
    expect(result.DB_PORT).toBe(5432)
    expect(result.DB_NAME).toBe('hub')
  })

  it('parses valid env vars', () => {
    const result = envSchema.parse({
      NODE_ENV: 'production',
      PORT: '8080',
      DB_HOST: 'db.example.com',
      DB_PORT: '5433',
      HUB_SESSION_SECRET: 'a-very-long-production-secret-that-is-32-chars',
    })
    expect(result.NODE_ENV).toBe('production')
    expect(result.PORT).toBe(8080)
    expect(result.DB_HOST).toBe('db.example.com')
    expect(result.DB_PORT).toBe(5433)
  })

  it('rejects invalid NODE_ENV', () => {
    const result = envSchema.safeParse({ NODE_ENV: 'staging' })
    expect(result.success).toBe(false)
  })

  it('rejects negative port', () => {
    const result = envSchema.safeParse({ PORT: '-1' })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer port', () => {
    const result = envSchema.safeParse({ PORT: '3.14' })
    expect(result.success).toBe(false)
  })

  it('rejects short hub session secret', () => {
    const result = envSchema.safeParse({ HUB_SESSION_SECRET: 'too-short' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid log level', () => {
    const result = envSchema.safeParse({ LOG_LEVEL: 'verbose' })
    expect(result.success).toBe(false)
  })

  it('coerces string port to number', () => {
    const result = envSchema.parse({ PORT: '9000' })
    expect(result.PORT).toBe(9000)
    expect(typeof result.PORT).toBe('number')
  })
})

describe('loadEnv', () => {
  it('returns parsed env from a custom source', () => {
    const result = loadEnv({ NODE_ENV: 'test', PORT: '4000' })
    expect(result.NODE_ENV).toBe('test')
    expect(result.PORT).toBe(4000)
    expect(result.DB_HOST).toBe('localhost')
  })

  it('throws on invalid env with formatted message', () => {
    expect(() => loadEnv({ HUB_SESSION_SECRET: 'x', LOG_LEVEL: 'verbose' as 'debug' })).toThrow(
      'Invalid environment variables',
    )
  })

  it('includes field names in error message', () => {
    try {
      loadEnv({ HUB_SESSION_SECRET: 'x' })
    } catch (err) {
      expect((err as Error).message).toContain('HUB_SESSION_SECRET')
    }
  })

  it('allows development environments to run with defaults', () => {
    expect(() => loadEnv({ NODE_ENV: 'development' })).not.toThrow()
  })
})

describe('loadEnv production fail-fast', () => {
  it('throws in production when required secrets are missing', () => {
    try {
      loadEnv({ NODE_ENV: 'production' })
      expect.unreachable('expected loadEnv to throw')
    } catch (err) {
      const message = (err as Error).message
      expect(message).toContain('HUB_SESSION_SECRET')
      expect(message).toContain('OIDC_COOKIE_KEYS')
      expect(message).toContain('HUB_CLIENT_SECRET')
      expect(message).toContain('DB_PASSWORD')
      expect(message).toContain('OIDC_SIGNING_KEY')
    }
  })

  it('throws in production when a secret equals its development default', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        ...VALID_PROD_SECRETS,
        HUB_SESSION_SECRET: 'hub-session-secret-minimum-32-characters-long!!',
      }),
    ).toThrow(/HUB_SESSION_SECRET.*development default/)
  })

  it('accepts production config with all secrets explicitly set', () => {
    const result = loadEnv({ NODE_ENV: 'production', ...VALID_PROD_SECRETS })
    expect(result.NODE_ENV).toBe('production')
    expect(result.HUB_SESSION_SECRET).toBe(VALID_PROD_SECRETS.HUB_SESSION_SECRET)
  })

  it('rejects empty-string secrets in production', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        ...VALID_PROD_SECRETS,
        OIDC_SIGNING_KEY: '',
      }),
    ).toThrow(/OIDC_SIGNING_KEY.*must be set explicitly/)
  })
})
