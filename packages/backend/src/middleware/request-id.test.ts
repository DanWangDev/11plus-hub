import { describe, it, expect, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { requestId } from './request-id.js'

function createMockReq(headers: Record<string, string> = {}): Request {
  return { headers, id: '' } as unknown as Request
}

function createMockRes(): Response {
  return {
    setHeader: vi.fn(),
  } as unknown as Response
}

describe('requestId middleware', () => {
  it('generates a UUID when no x-request-id header is present', () => {
    const req = createMockReq()
    const res = createMockRes()
    const next: NextFunction = vi.fn()

    requestId(req, res, next)

    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.id)
    expect(next).toHaveBeenCalled()
  })

  it('uses existing x-request-id header when present', () => {
    const req = createMockReq({ 'x-request-id': 'custom-id-123' })
    const res = createMockRes()
    const next: NextFunction = vi.fn()

    requestId(req, res, next)

    expect(req.id).toBe('custom-id-123')
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'custom-id-123')
    expect(next).toHaveBeenCalled()
  })
})
