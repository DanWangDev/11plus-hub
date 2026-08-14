import type { Request, Response, NextFunction } from 'express'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'error-handler' })

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: 'Not found',
  })
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.code && { code: err.code }),
    })
    return
  }

  // Unknown errors were previously swallowed silently — log them with the
  // request context so 500s are diagnosable.
  logger.error('unhandled request error', {
    operation: 'errorHandler',
    requestId: req.id ?? null,
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  })

  const isDev = process.env.NODE_ENV !== 'production'

  res.status(500).json({
    success: false,
    error: isDev ? err.message : 'Internal server error',
  })
}
