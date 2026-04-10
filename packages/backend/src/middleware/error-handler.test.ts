import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { AppError, notFoundHandler, errorHandler } from './error-handler.js'

function createMockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response
  return res
}

function createMockReq(overrides: Partial<Request> = {}): Request {
  return { ...overrides } as Request
}

describe('AppError', () => {
  it('creates error with status code and message', () => {
    const err = new AppError(400, 'Bad request')
    expect(err.statusCode).toBe(400)
    expect(err.message).toBe('Bad request')
    expect(err.name).toBe('AppError')
    expect(err.code).toBeUndefined()
  })

  it('creates error with optional code', () => {
    const err = new AppError(409, 'Conflict', 'DUPLICATE_EMAIL')
    expect(err.code).toBe('DUPLICATE_EMAIL')
  })

  it('is an instance of Error', () => {
    const err = new AppError(500, 'fail')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('notFoundHandler', () => {
  it('returns 404 with standard response', () => {
    const req = createMockReq()
    const res = createMockRes()

    notFoundHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Not found',
    })
  })
})

describe('errorHandler', () => {
  const next: NextFunction = vi.fn()

  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('handles AppError with status code and message', () => {
    const err = new AppError(422, 'Invalid input', 'VALIDATION_ERROR')
    const req = createMockReq()
    const res = createMockRes()

    errorHandler(err, req, res, next)

    expect(res.status).toHaveBeenCalledWith(422)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid input',
      code: 'VALIDATION_ERROR',
    })
  })

  it('handles AppError without code', () => {
    const err = new AppError(400, 'Bad request')
    const req = createMockReq()
    const res = createMockRes()

    errorHandler(err, req, res, next)

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Bad request',
    })
  })

  it('hides error details in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const err = new Error('database connection failed')
    const req = createMockReq()
    const res = createMockRes()

    errorHandler(err, req, res, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Internal server error',
    })
  })

  it('shows error details in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const err = new Error('some debug info')
    const req = createMockReq()
    const res = createMockRes()

    errorHandler(err, req, res, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'some debug info',
    })
  })
})
