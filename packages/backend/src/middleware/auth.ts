import type { Request, Response, NextFunction } from 'express'
import { getIronSession } from 'iron-session'
import { decodeJwt } from 'jose'
import { db } from '../db/connection.js'
import { updateLastActive } from '../services/user-service.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'auth-middleware' })

const COOKIE_NAME = '__hub_session'

interface SessionData {
  tokens?: {
    id_token?: string
    access_token?: string
    refresh_token?: string
  }
}

export interface AuthUser {
  sub: string
  username: string
  role: string
  email?: string
}

/**
 * Creates middleware that validates the hub session cookie and attaches
 * the authenticated user to `res.locals.user`.
 *
 * Returns 401 if no valid session exists.
 */
export function createRequireAuth(sessionSecret: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await getIronSession<SessionData>(req, res, {
        password: sessionSecret,
        cookieName: COOKIE_NAME,
        cookieOptions: {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax' as const,
          maxAge: 7 * 24 * 60 * 60,
        },
      })

      if (!session.tokens?.id_token) {
        logger.warn('auth middleware: no session token', {
          operation: 'requireAuth',
          path: req.path,
        })
        res.status(401).json({ success: false, error: 'Not authenticated' })
        return
      }

      const claims = decodeJwt(session.tokens.id_token)

      const user: AuthUser = {
        sub: String(claims.sub ?? ''),
        username: String((claims as Record<string, unknown>).username ?? ''),
        role: String((claims as Record<string, unknown>).role ?? 'student'),
        email: (claims as Record<string, unknown>).email as string | undefined,
      }

      res.locals.user = user

      // Fire-and-forget activity bump. updateLastActive throttles to once
      // per 5 min per user via its SQL WHERE clause, so calling it on every
      // request is cheap (a single indexed conditional UPDATE).
      const userIdNum = Number.parseInt(user.sub, 10)
      if (Number.isFinite(userIdNum)) {
        updateLastActive(db, userIdNum).catch((err) => {
          logger.warn('failed to update last_active_at in auth middleware', {
            operation: 'requireAuth',
            userId: userIdNum,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }

      next()
    } catch (error) {
      logger.error('auth middleware failed', {
        operation: 'requireAuth',
        path: req.path,
        error: error instanceof Error ? error.message : String(error),
      })
      res.status(401).json({ success: false, error: 'Not authenticated' })
    }
  }
}

/**
 * Middleware that checks if the authenticated user has the 'admin' role.
 * Must be used after `createRequireAuth()`.
 *
 * Returns 403 if the user is not an admin.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = res.locals.user as AuthUser | undefined

  if (!user) {
    res.status(401).json({ success: false, error: 'Not authenticated' })
    return
  }

  if (user.role !== 'admin') {
    logger.warn('admin access denied', {
      operation: 'requireAdmin',
      path: req.path,
      method: req.method,
      username: user.username,
      role: user.role,
    })
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }

  next()
}
