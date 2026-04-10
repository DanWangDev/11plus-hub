import { describe, it, expect, vi } from 'vitest'
import { generateDevSigningKey } from './dev-keys.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('dev-keys', () => {
  it('generates a valid JWK signing key', async () => {
    const keyStr = await generateDevSigningKey()
    const key = JSON.parse(keyStr)

    expect(key.kty).toBe('RSA')
    expect(key.kid).toBe('dev-key-1')
    expect(key.use).toBe('sig')
    expect(key.alg).toBe('RS256')
    expect(key.n).toBeDefined()
    expect(key.d).toBeDefined()
  })
})
