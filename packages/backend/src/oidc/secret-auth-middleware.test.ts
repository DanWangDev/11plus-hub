import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'crypto'
import { createSecretAuthMiddleware } from './secret-auth-middleware.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

function createMockReqRes(method: string, body: Record<string, unknown> = {}) {
  const req = { method, body } as { method: string; body: Record<string, unknown> }
  const res = {} as Record<string, unknown>
  const next = vi.fn()
  return { req, res, next }
}

describe('secretAuthMiddleware', () => {
  const middleware = createSecretAuthMiddleware()

  it('hashes client_secret in POST body', () => {
    const secret = 'my-plaintext-secret'
    const expectedHash = createHash('sha256').update(secret).digest('hex')

    const { req, res, next } = createMockReqRes('POST', {
      client_id: 'test-client',
      client_secret: secret,
      grant_type: 'authorization_code',
    })

    middleware(req as never, res as never, next)

    expect(req.body.client_secret).toBe(expectedHash)
    expect(req.body.client_id).toBe('test-client')
    expect(req.body.grant_type).toBe('authorization_code')
    expect(next).toHaveBeenCalled()
  })

  it('passes through GET requests unchanged', () => {
    const { req, res, next } = createMockReqRes('GET', {
      client_secret: 'should-not-be-touched',
    })

    middleware(req as never, res as never, next)

    expect(req.body.client_secret).toBe('should-not-be-touched')
    expect(next).toHaveBeenCalled()
  })

  it('passes through POST without client_secret', () => {
    const { req, res, next } = createMockReqRes('POST', {
      client_id: 'test-client',
      grant_type: 'authorization_code',
    })

    middleware(req as never, res as never, next)

    expect(req.body.client_secret).toBeUndefined()
    expect(next).toHaveBeenCalled()
  })

  it('passes through POST with empty body', () => {
    const { req, res, next } = createMockReqRes('POST')

    middleware(req as never, res as never, next)

    expect(next).toHaveBeenCalled()
  })
})
