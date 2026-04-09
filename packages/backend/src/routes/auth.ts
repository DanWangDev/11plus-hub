import { Router } from 'express'
import type { Request, Response } from 'express'
import { ZodError } from 'zod'
import { db } from '../db/connection.js'
import { env } from '../config/env.js'
import { createLogger } from '../lib/logger.js'
import {
  createUser,
  createUserSchema,
  findUserByEmail,
  findUserByGoogleId,
  findUserByUsername,
  generateUniqueUsername,
  verifyPassword,
} from '../services/user-service.js'
import { verifyGoogleToken, isGoogleConfigured } from '../services/google-auth-service.js'
import { verifyTurnstileToken } from '../services/turnstile-service.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import type postgres from 'postgres'
import { loginLimiter, registerLimiter } from '../middleware/rate-limit.js'

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

  router.post('/api/auth/login', loginLimiter, async (req: Request, res: Response) => {
    const start = Date.now()
    try {
      const { email, username, password, turnstileToken } = req.body as {
        email?: string
        username?: string
        password?: string
        turnstileToken?: string
      }

      if (env.TURNSTILE_SECRET_KEY) {
        const ip = req.ip ?? req.socket.remoteAddress ?? ''
        const ok = await verifyTurnstileToken(turnstileToken ?? '', ip)
        if (!ok) {
          logger.warn('login turnstile failed', {
            operation: 'login',
            duration: Date.now() - start,
          })
          res.status(403).json({ success: false, error: 'Bot verification failed' })
          return
        }
      }

      const identifier = email ?? username
      if (!identifier || !password) {
        logger.warn('login missing credentials', {
          operation: 'login',
          duration: Date.now() - start,
        })
        res.status(400).json({
          success: false,
          error: 'Email or username, and password are required',
        })
        return
      }

      const user = identifier.includes('@')
        ? await findUserByEmail(sql, identifier)
        : await findUserByUsername(sql, identifier)

      if (!user || !user.password_hash) {
        logger.warn('login failed - user not found or no password', {
          operation: 'login',
          duration: Date.now() - start,
        })

        await logAction(sql, {
          action: AuditActions.LOGIN_FAILED,
          details: { reason: 'user_not_found', identifier },
          ipAddress: req.ip,
        }).catch(() => {})

        res.status(401).json({
          success: false,
          error: 'Invalid credentials',
        })
        return
      }

      const valid = await verifyPassword(password, user.password_hash)

      if (!valid) {
        logger.warn('login failed - wrong password', {
          operation: 'login',
          userId: user.id,
          duration: Date.now() - start,
        })

        await logAction(sql, {
          actorId: user.id,
          action: AuditActions.LOGIN_FAILED,
          details: { reason: 'wrong_password' },
          ipAddress: req.ip,
        }).catch(() => {})

        res.status(401).json({
          success: false,
          error: 'Invalid credentials',
        })
        return
      }

      const { password_hash: _, ...userWithoutPassword } = user

      logger.info('user logged in', {
        operation: 'login',
        userId: user.id,
        duration: Date.now() - start,
      })

      await logAction(sql, {
        actorId: user.id,
        action: AuditActions.LOGIN,
        ipAddress: req.ip,
      }).catch(() => {})

      res.json({
        success: true,
        data: {
          user: userWithoutPassword,
          token: 'placeholder-jwt-token',
        },
      })
    } catch (error) {
      logger.error('login failed', {
        operation: 'login',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start,
      })
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      })
    }
  })

  router.post('/api/auth/google', loginLimiter, async (req: Request, res: Response) => {
    const start = Date.now()

    if (!isGoogleConfigured()) {
      res.status(501).json({ success: false, error: 'Google sign-in is not configured' })
      return
    }

    try {
      const { token, tokenType, turnstileToken } = req.body as {
        token?: string
        tokenType?: 'id_token' | 'access_token'
        turnstileToken?: string
      }

      if (env.TURNSTILE_SECRET_KEY) {
        const ip = req.ip ?? req.socket.remoteAddress ?? ''
        const ok = await verifyTurnstileToken(turnstileToken ?? '', ip)
        if (!ok) {
          logger.warn('google auth turnstile failed', {
            operation: 'google-auth',
            duration: Date.now() - start,
          })
          res.status(403).json({ success: false, error: 'Bot verification failed' })
          return
        }
      }

      if (!token) {
        res.status(400).json({ success: false, error: 'Google token is required' })
        return
      }

      const googleUser = await verifyGoogleToken(token, tokenType ?? 'id_token')

      // Check if user exists by google_id
      let user = await findUserByGoogleId(sql, googleUser.googleId)
      let isNewUser = false

      if (!user) {
        // Check if user exists by email — link accounts
        const existingByEmail = await findUserByEmail(sql, googleUser.email)
        if (existingByEmail) {
          const rows = await sql<
            {
              id: number
              username: string
              email: string
              display_name: string
              role: string
              parent_id: number | null
              google_id: string | null
              email_verified: boolean
              created_at: Date
              updated_at: Date
              deleted_at: Date | null
            }[]
          >`
            UPDATE users
            SET google_id = ${googleUser.googleId}, email_verified = true, updated_at = now()
            WHERE id = ${existingByEmail.id}
            RETURNING id, username, email, display_name, role, parent_id, google_id, email_verified, created_at, updated_at, deleted_at
          `
          user = rows[0] ?? null
          logger.info('linked google account to existing user', {
            operation: 'google-auth',
            userId: existingByEmail.id,
            duration: Date.now() - start,
          })
        } else {
          // Create new user from Google profile
          const username = await generateUniqueUsername(sql, googleUser.email)

          user = await createUser(sql, {
            username,
            email: googleUser.email,
            displayName: googleUser.name,
            googleId: googleUser.googleId,
            role: 'student',
          })
          isNewUser = true

          logger.info('created user via google', {
            operation: 'google-auth',
            userId: user.id,
            duration: Date.now() - start,
          })
        }
      } else {
        logger.info('user authenticated via google', {
          operation: 'google-auth',
          userId: user.id,
          duration: Date.now() - start,
        })
      }

      if (!user) {
        res.status(500).json({ success: false, error: 'Failed to authenticate with Google' })
        return
      }

      await logAction(sql, {
        actorId: user.id,
        action: isNewUser ? AuditActions.REGISTER : AuditActions.LOGIN,
        details: { source: 'google' },
        ipAddress: req.ip,
      }).catch(() => {})

      res.status(isNewUser ? 201 : 200).json({
        success: true,
        data: {
          user,
          token: 'placeholder-jwt-token',
          isNewUser,
        },
      })
    } catch (error) {
      logger.error('google auth failed', {
        operation: 'google-auth',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start,
      })
      res.status(401).json({ success: false, error: 'Google authentication failed' })
    }
  })

  return router
}
