import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { db } from '../db/connection.js'
import { createLogger } from '../lib/logger.js'
import { findUserByEmail } from '../services/user-service.js'
import {
  createResetToken,
  resetPassword,
  requestResetSchema,
  resetPasswordSchema,
} from '../services/password-reset-service.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import type postgres from 'postgres'
import { passwordResetLimiter } from '../middleware/rate-limit.js'

interface PasswordResetRouterOptions {
  sql?: postgres.Sql
}

export function createPasswordResetRouter(options: PasswordResetRouterOptions = {}): Router {
  const router = Router()
  const sql = options.sql ?? db
  const logger = createLogger({ route: 'password-reset' })

  // POST /api/auth/forgot-password — request a password reset
  router.post(
    '/api/auth/forgot-password',
    passwordResetLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const { email } = requestResetSchema.parse(req.body)

        // Always return success to prevent email enumeration
        const user = await findUserByEmail(sql, email)

        if (user) {
          const token = await createResetToken(sql, user.id)

          logger.info('password reset requested', {
            operation: 'forgotPassword',
            userId: user.id,
            selector: token.selector,
            duration: Date.now() - start,
          })

          await logAction(sql, {
            actorId: user.id,
            action: AuditActions.PASSWORD_RESET_REQUEST,
            ipAddress: req.ip,
          }).catch(() => {})

          // TODO: Send email with reset link containing selector + validator
          // For now, return the token in dev mode for testing
          if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
            res.json({
              success: true,
              data: {
                message: 'If an account exists with that email, a reset link has been sent',
                _dev: { selector: token.selector, validator: token.validator },
              },
            })
            return
          }
        } else {
          logger.info('password reset requested for unknown email', {
            operation: 'forgotPassword',
            duration: Date.now() - start,
          })
        }

        res.json({
          success: true,
          data: {
            message: 'If an account exists with that email, a reset link has been sent',
          },
        })
      } catch (error) {
        if (error instanceof ZodError) {
          logger.warn('forgot password validation failed', {
            operation: 'forgotPassword',
            duration: Date.now() - start,
          })
          res.status(400).json({
            success: false,
            error: 'Validation failed',
          })
          return
        }
        next(error)
      }
    },
  )

  // POST /api/auth/reset-password — complete password reset
  router.post(
    '/api/auth/reset-password',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const data = resetPasswordSchema.parse(req.body)
        const success = await resetPassword(sql, data)

        if (!success) {
          logger.warn('password reset failed - invalid or expired token', {
            operation: 'resetPassword',
            selector: data.selector,
            duration: Date.now() - start,
          })
          res.status(400).json({
            success: false,
            error: 'Invalid or expired reset token',
          })
          return
        }

        logger.info('password reset completed via route', {
          operation: 'resetPassword',
          duration: Date.now() - start,
        })

        await logAction(sql, {
          action: AuditActions.PASSWORD_RESET_COMPLETE,
          ipAddress: req.ip,
        }).catch(() => {})

        res.json({
          success: true,
          data: { message: 'Password has been reset successfully' },
        })
      } catch (error) {
        if (error instanceof ZodError) {
          logger.warn('reset password validation failed', {
            operation: 'resetPassword',
            duration: Date.now() - start,
          })
          res.status(400).json({
            success: false,
            error: 'Validation failed',
          })
          return
        }
        next(error)
      }
    },
  )

  return router
}
