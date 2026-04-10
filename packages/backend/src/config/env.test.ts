import { describe, it, expect } from 'vitest'
import { envSchema, loadEnv } from './env.js'

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
      SESSION_SECRET: 'a-very-long-production-secret-that-is-32-chars',
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

  it('rejects short session secret', () => {
    const result = envSchema.safeParse({ SESSION_SECRET: 'too-short' })
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
    expect(() => loadEnv({ SESSION_SECRET: 'x', LOG_LEVEL: 'verbose' as 'debug' })).toThrow(
      'Invalid environment variables',
    )
  })

  it('includes field names in error message', () => {
    try {
      loadEnv({ SESSION_SECRET: 'x' })
    } catch (err) {
      expect((err as Error).message).toContain('SESSION_SECRET')
    }
  })
})
