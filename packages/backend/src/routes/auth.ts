import { Router } from 'express'
import type { Request, Response } from 'express'
import { ZodError } from 'zod'
import { db } from '../db/connection.js'
import { env } from '../config/env.js'
import { createLogger } from '../lib/logger.js'
import { createUser, createUserSchema } from '../services/user-service.js'
import { verifyTurnstileToken } from '../services/turnstile-service.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import type postgres from 'postgres'
import { registerLimiter } from '../middleware/rate-limit.js'

interface AuthRouterOptions {
  sql?: postgres.Sql
}

export function createAuthRouter(options: AuthRouterOptions = {}): Router {
  const router = Router()
  const sql = options.sql ?? db
  const logger = createLogger({ route: 'auth' })

  router.post('/api/auth/register', registerLimiter, async (req: Request, res: Response) => {
    const start = Date.now()
    try {
      const { turnstileToken, ...body } = req.body as Record<string, unknown> & {
        turnstileToken?: string
      }

      if (env.TURNSTILE_SECRET_KEY) {
        const ip = req.ip ?? req.socket.remoteAddress ?? ''
        const ok = await verifyTurnstileToken(turnstileToken ?? '', ip)
        if (!ok) {
          logger.warn('registration turnstile failed', {
            operation: 'register',
            duration: Date.now() - start,
          })
          res.status(403).json({ success: false, error: 'Bot verification failed' })
          return
        }
      }

      const data = createUserSchema.parse(body)
      const user = await createUser(sql, data)

      logger.info('user registered', {
        operation: 'register',
        userId: user.id,
        duration: Date.now() - start,
      })

      await logAction(sql, {
        actorId: user.id,
        action: AuditActions.REGISTER,
        details: { username: user.username },
        ipAddress: req.ip,
      }).catch(() => {})

      res.status(201).json({
        success: true,
        data: user,
      })
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn('registration validation failed', {
          operation: 'register',
          duration: Date.now() - start,
        })
        res.status(400).json({
          success: false,
          error: 'Validation failed',
        })
        return
      }

      const pgError = error as { code?: string }
      if (pgError.code === '23505') {
        logger.warn('registration duplicate conflict', {
          operation: 'register',
          duration: Date.now() - start,
        })
        res.status(409).json({
          success: false,
          error: 'User already exists',
        })
        return
      }

      logger.error('registration failed', {
        operation: 'register',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start,
      })
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      })
    }
  })

  return router
}
