import bcrypt from 'bcrypt'
import { Router } from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import type postgres from 'postgres'
import { getIronSession } from 'iron-session'
import { createLogger } from '../lib/logger.js'
import {
  MIN_PASSWORD_LENGTH,
  findUserById,
  findUserWithPasswordHash,
  updateUser,
  updatePassword,
  verifyPassword,
} from '../services/user-service.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import { profileUpdateLimiter } from '../middleware/rate-limit.js'
import type { AuthUser } from '../middleware/auth.js'
import type { SessionData } from './hub-auth.js'
import { COOKIE_NAME } from './hub-auth.js'

const logger = createLogger({ service: 'profile' })

const BCRYPT_ROUNDS = 12

// --- Schemas ---

const updateDisplayNameSchema = z.object({
  displayName: z.string().min(1).max(100),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
})

// --- Router ---

export interface ProfileRouterOptions {
  sql?: postgres.Sql
  sessionSecret: string
}

export function createProfileRouter(options: ProfileRouterOptions): Router {
  const router = Router()
  const { sql, sessionSecret } = options

  /** Helper: extract and validate the authenticated user ID from the request. */
  function getAuthUserId(res: Response): number | null {
    const authUser = res.locals.user as AuthUser | undefined
    if (!authUser?.sub) {
      res.status(401).json({ success: false, error: 'Not authenticated' })
      return null
    }
    const userId = Number(authUser.sub)
    if (Number.isNaN(userId)) {
      res.status(400).json({ success: false, error: 'Invalid user ID' })
      return null
    }
    return userId
  }

  // PATCH /api/profile — update display name only
  router.patch('/api/profile', profileUpdateLimiter, async (req: Request, res: Response) => {
    if (!sql) {
      res.status(503).json({ success: false, error: 'Database not available' })
      return
    }

    const userId = getAuthUserId(res)
    if (userId === null) return

    const parsed = updateDisplayNameSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }

    const { displayName } = parsed.data

    try {
      await updateUser(sql, userId, { displayName })

      await logAction(sql, {
        actorId: userId,
        action: AuditActions.PROFILE_UPDATE,
        targetId: userId,
        details: { field: 'display_name' },
        ipAddress: req.ip ?? undefined,
      })

      logger.info('profile display name updated', {
        operation: 'profileUpdate',
        userId,
        displayName,
      })

      // Store profileOverrides in session so /api/auth/me reflects the change
      // without requiring a full re-authentication
      const session = await getIronSession<SessionData>(req, res, {
        password: sessionSecret,
        cookieName: COOKIE_NAME,
        cookieOptions: {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax' as const,
          path: '/',
          maxAge: 7 * 24 * 60 * 60,
        },
      })

      session.profileOverrides = {
        ...(session.profileOverrides ?? {}),
        display_name: displayName,
      }
      await session.save()

      const updatedUser = await findUserById(sql, userId)
      res.json({ success: true, data: updatedUser })
    } catch (error) {
      logger.error('profile display name update failed', {
        operation: 'profileUpdate',
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
      res.status(500).json({ success: false, error: 'Profile update failed' })
    }
  })

  // PATCH /api/profile/password — change password only
  router.patch(
    '/api/profile/password',
    profileUpdateLimiter,
    async (req: Request, res: Response) => {
      if (!sql) {
        res.status(503).json({ success: false, error: 'Database not available' })
        return
      }

      const userId = getAuthUserId(res)
      if (userId === null) return

      const parsed = changePasswordSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        })
        return
      }

      const { currentPassword, newPassword } = parsed.data

      try {
        const userWithHash = await findUserWithPasswordHash(sql, userId)
        if (!userWithHash) {
          res.status(404).json({ success: false, error: 'User not found' })
          return
        }

        if (!userWithHash.password_hash) {
          res.status(400).json({
            success: false,
            error: 'Account uses Google sign-in only. Set a password via forgot-password first.',
          })
          return
        }

        const valid = await verifyPassword(currentPassword, userWithHash.password_hash)
        if (!valid) {
          logger.warn('profile password change: incorrect current password', {
            operation: 'passwordChange',
            userId,
          })
          res.status(403).json({ success: false, error: 'Current password is incorrect' })
          return
        }

        const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
        await updatePassword(sql, userId, newHash)

        await logAction(sql, {
          actorId: userId,
          action: AuditActions.PASSWORD_CHANGE,
          targetId: userId,
          details: {},
          ipAddress: req.ip ?? undefined,
        })

        logger.info('profile password changed', {
          operation: 'passwordChange',
          userId,
        })

        res.json({ success: true })
      } catch (error) {
        logger.error('profile password change failed', {
          operation: 'passwordChange',
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
        res.status(500).json({ success: false, error: 'Password change failed' })
      }
    },
  )

  return router
}
