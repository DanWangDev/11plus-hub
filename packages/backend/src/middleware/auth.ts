import type { Request, Response, NextFunction } from 'express'
import { decodeJwt } from 'jose'
import { db } from '../db/connection.js'
import { updateLastActive } from '../services/user-service.js'
import { getHubSession } from '../lib/session.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'auth-middleware' })

interface SessionData {
  tokens?: {
    id_token?: string
    access_token?: string
    refresh_token?: string
  }
  impersonation?: {
    targetUserId: number
    claims: Record<string, unknown>
    impersonatedBy: {
      adminUserId: number
      adminUsername: string
      startedAt: string
    }
  }
}

export interface AuthUser {
  sub: string
  username: string
  role: string
  email?: string
  isImpersonating?: boolean
  impersonatedBy?: {
    adminUserId: number
    adminUsername: string
    startedAt: string
  }
}

/**
 * Creates middleware that validates the hub session cookie and attaches
 * the authenticated user to `res.locals.user`.
 *
 * During impersonation, the impersonated user's identity is used instead
 * of the original id_token claims. The admin's identity is preserved in
 * `res.locals.user.impersonatedBy`.
 *
 * Returns 401 if no valid session exists.
 */
export function createRequireAuth(sessionSecret: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await getHubSession<SessionData>(req, res, sessionSecret)

      let user: AuthUser

      if (session.impersonation) {
        // Use impersonated user's identity, but flag it
        const claims = session.impersonation.claims
        user = {
          sub: String(claims.sub ?? ''),
          username: String(claims.username ?? ''),
          role: String(claims.role ?? 'student'),
          email: claims.email as string | undefined,
          isImpersonating: true,
          impersonatedBy: session.impersonation.impersonatedBy,
        }
      } else if (session.tokens?.id_token) {
        const claims = decodeJwt(session.tokens.id_token)

        user = {
          sub: String(claims.sub ?? ''),
          username: String((claims as Record<string, unknown>).username ?? ''),
          role: String((claims as Record<string, unknown>).role ?? 'student'),
          email: (claims as Record<string, unknown>).email as string | undefined,
        }
      } else {
        logger.warn('auth middleware: no session token', {
          operation: 'requireAuth',
          path: req.path,
        })
        res.status(401).json({ success: false, error: 'Not authenticated' })
        return
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
