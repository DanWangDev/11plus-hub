import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'
import { createRequireAuth, requireAdmin } from './auth.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../db/connection.js', () => ({
  db: {},
}))

const { mockUpdateLastActive } = vi.hoisted(() => ({
  mockUpdateLastActive: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/user-service.js', () => ({
  updateLastActive: (...args: unknown[]) => mockUpdateLastActive(...args),
}))

// Mock iron-session
const mockSession: Record<string, unknown> = {}
vi.mock('iron-session', () => ({
  getIronSession: vi.fn(async () => mockSession),
}))

// Mock jose
vi.mock('jose', () => ({
  decodeJwt: vi.fn((token: string) => JSON.parse(atob(token.split('.')[1]))),
}))

function createMockReq(overrides: Partial<Request> = {}): Request {
  return { path: '/api/test', method: 'GET', ...overrides } as Request
}

function createMockRes(): Response & { _status: number; _json: unknown } {
  const res = {
    _status: 200,
    _json: null,
    locals: {} as Record<string, unknown>,
    status(code: number) {
      res._status = code
      return res
    },
    json(data: unknown) {
      res._json = data
      return res
    },
  }
  return res as unknown as Response & { _status: number; _json: unknown }
}

// Helper to create a fake JWT with given claims
function fakeJwt(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none' }))
  const payload = btoa(JSON.stringify(claims))
  return `${header}.${payload}.sig`
}

describe('createRequireAuth', () => {
  const requireAuth = createRequireAuth('a-secret-that-is-at-least-32-chars-long!')

  beforeEach(() => {
    // Reset mock session
    Object.keys(mockSession).forEach((k) => delete mockSession[k])
    mockUpdateLastActive.mockClear()
  })

  it('returns 401 when no session tokens exist', async () => {
    const req = createMockReq()
    const res = createMockRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(res._json).toEqual({ success: false, error: 'Not authenticated' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when tokens exist but id_token is missing', async () => {
    mockSession.tokens = { access_token: 'abc' }
    const req = createMockReq()
    const res = createMockRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('attaches user to res.locals and calls next on valid session', async () => {
    const token = fakeJwt({
      sub: '42',
      username: 'testuser',
      role: 'admin',
      email: 'test@example.com',
    })
    mockSession.tokens = { id_token: token }

    const req = createMockReq()
    const res = createMockRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.locals.user).toEqual({
      sub: '42',
      username: 'testuser',
      role: 'admin',
      email: 'test@example.com',
    })
    // Every authenticated request bumps last_active_at (throttled in SQL)
    expect(mockUpdateLastActive).toHaveBeenCalledWith(expect.anything(), 42)
  })

  it('does not call updateLastActive when sub is not a number', async () => {
    const token = fakeJwt({ sub: 'not-numeric', username: 'x' })
    mockSession.tokens = { id_token: token }

    const req = createMockReq()
    const res = createMockRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(mockUpdateLastActive).not.toHaveBeenCalled()
  })

  it('defaults role to student when not in claims', async () => {
    const token = fakeJwt({ sub: '1', username: 'noroleguy' })
    mockSession.tokens = { id_token: token }

    const req = createMockReq()
    const res = createMockRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect((res.locals.user as { role: string }).role).toBe('student')
  })

  it('returns 401 when decodeJwt throws', async () => {
    mockSession.tokens = { id_token: 'not-a-valid-jwt' }

    const req = createMockReq()
    const res = createMockRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(res._json).toEqual({ success: false, error: 'Not authenticated' })
    expect(next).not.toHaveBeenCalled()
  })
})

describe('requireAdmin', () => {
  it('returns 401 when no user on res.locals', () => {
    const req = createMockReq()
    const res = createMockRes()
    const next = vi.fn()

    requireAdmin(req, res, next)

    expect(res._status).toBe(401)
    expect(res._json).toEqual({ success: false, error: 'Not authenticated' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when user is not admin', () => {
    const req = createMockReq()
    const res = createMockRes()
    res.locals.user = { sub: '1', username: 'emma', role: 'student' }
    const next = vi.fn()

    requireAdmin(req, res, next)

    expect(res._status).toBe(403)
    expect(res._json).toEqual({ success: false, error: 'Admin access required' })
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next when user is admin', () => {
    const req = createMockReq()
    const res = createMockRes()
    res.locals.user = { sub: '1', username: 'BigDaddy', role: 'admin' }
    const next = vi.fn()

    requireAdmin(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('returns 403 for parent role', () => {
    const req = createMockReq()
    const res = createMockRes()
    res.locals.user = { sub: '2', username: 'parent1', role: 'parent' }
    const next = vi.fn()

    requireAdmin(req, res, next)

    expect(res._status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })
})
