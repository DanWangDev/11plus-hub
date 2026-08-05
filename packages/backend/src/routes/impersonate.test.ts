import { describe, it, expect, vi } from 'vitest'
import { blockWriteDuringImpersonation } from './impersonate.js'
import type { Request, Response, NextFunction } from 'express'

function mockReqRes(method: string, path: string, user?: Record<string, unknown>) {
  const req = {
    method,
    path,
  } as Request
  const res = {
    locals: { user: user ?? null },
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response
  const next = vi.fn() as NextFunction
  return { req, res, next }
}

describe('blockWriteDuringImpersonation', () => {
  it('calls next when not impersonating', () => {
    const { req, res, next } = mockReqRes('POST', '/api/users', {})
    blockWriteDuringImpersonation(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('calls next for GET requests during impersonation', () => {
    const { req, res, next } = mockReqRes('GET', '/api/users', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('blocks POST requests during impersonation', () => {
    const { req, res, next } = mockReqRes('POST', '/api/users', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Read-only') }),
    )
  })

  it('blocks PATCH requests during impersonation', () => {
    const { req, res, next } = mockReqRes('PATCH', '/api/users/1', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('blocks DELETE requests during impersonation', () => {
    const { req, res, next } = mockReqRes('DELETE', '/api/users/1', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('allows HEAD requests during impersonation', () => {
    const { req, res, next } = mockReqRes('HEAD', '/api/apps', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('allows OPTIONS requests during impersonation', () => {
    const { req, res, next } = mockReqRes('OPTIONS', '/api/apps', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('allows POST to impersonate end during impersonation', () => {
    const { req, res, next } = mockReqRes('POST', '/api/admin/impersonate/end', {
      isImpersonating: true,
    })
    blockWriteDuringImpersonation(req, res, next)
    expect(next).toHaveBeenCalled()
  })
})
