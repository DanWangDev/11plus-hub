import rateLimit from 'express-rate-limit'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'rate-limit' })

const isTest = process.env.NODE_ENV === 'test'

// Login: 5 attempts per 15 minutes per IP
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    success: false,
    error: 'Too many login attempts, please try again later',
  },
  handler: (_req, res, _next, options) => {
    logger.warn('login rate limit exceeded', {
      operation: 'rateLimitExceeded',
      limiter: 'login',
    })
    res.status(options.statusCode).json(options.message)
  },
  keyGenerator: (req) => req.ip ?? 'unknown',
})

// Registration: 3 per hour per IP
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    success: false,
    error: 'Too many registration attempts, please try again later',
  },
  handler: (_req, res, _next, options) => {
    logger.warn('registration rate limit exceeded', {
      operation: 'rateLimitExceeded',
      limiter: 'register',
    })
    res.status(options.statusCode).json(options.message)
  },
  keyGenerator: (req) => req.ip ?? 'unknown',
})

// Password reset: 3 per hour per IP
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    success: false,
    error: 'Too many password reset attempts, please try again later',
  },
  handler: (_req, res, _next, options) => {
    logger.warn('password reset rate limit exceeded', {
      operation: 'rateLimitExceeded',
      limiter: 'passwordReset',
    })
    res.status(options.statusCode).json(options.message)
  },
  keyGenerator: (req) => req.ip ?? 'unknown',
})

// Profile update: 10 per hour per IP
export const profileUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    success: false,
    error: 'Too many profile update attempts, please try again later',
  },
  handler: (_req, res, _next, options) => {
    logger.warn('profile update rate limit exceeded', {
      operation: 'rateLimitExceeded',
      limiter: 'profileUpdate',
    })
    res.status(options.statusCode).json(options.message)
  },
  keyGenerator: (req) => req.ip ?? 'unknown',
})

// General API: 100 requests per minute per IP
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    success: false,
    error: 'Too many requests, please try again later',
  },
  handler: (_req, res, _next, options) => {
    logger.warn('api rate limit exceeded', {
      operation: 'rateLimitExceeded',
      limiter: 'api',
    })
    res.status(options.statusCode).json(options.message)
  },
  keyGenerator: (req) => req.ip ?? 'unknown',
})
