import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import type postgres from 'postgres'
import { createLogger } from '../lib/logger.js'
import { findUserById } from '../services/user-service.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import { buildUserClaims } from '../oidc/user-claims.js'
import { getHubSession } from '../lib/session.js'
import type { RequestHandler } from 'express'
import { type SessionData } from './hub-auth.js'

const logger = createLogger({ route: 'impersonate' })

interface ImpersonateRouterOptions {
  sql: postgres.Sql
  sessionSecret: string
  requireAuth: RequestHandler
  requireAdmin: RequestHandler
}

export function createImpersonateRouter(options: ImpersonateRouterOptions): Router {
  const { sql, sessionSecret, requireAuth, requireAdmin } = options
  const router = Router()

  // POST /api/admin/impersonate — start impersonating a user
  router.post(
    '/api/admin/impersonate',
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const { userId } = req.body as { userId?: number }
        if (!userId || !Number.isFinite(userId)) {
          res.status(400).json({ success: false, error: 'Valid userId is required' })
          return
        }

        const targetUser = await findUserById(sql, userId)
        if (!targetUser) {
          res.status(404).json({ success: false, error: 'User not found' })
          return
        }

        // Don't impersonate yourself
        const adminUser = res.locals.user as { sub: string; username: string } | undefined
        if (adminUser && String(targetUser.id) === adminUser.sub) {
          res.status(400).json({ success: false, error: 'Cannot impersonate yourself' })
          return
        }

        const claims = await buildUserClaims(sql, targetUser.id, 'impersonate')

        // 30-minute cookie while impersonating (expires even if the admin
        // walks away without ending the impersonation)
        const session = await getHubSession<SessionData>(req, res, sessionSecret, 30 * 60)

        session.impersonation = {
          targetUserId: targetUser.id,
          claims,
          impersonatedBy: {
            adminUserId: Number(adminUser?.sub ?? 0),
            adminUsername: adminUser?.username ?? 'unknown',
            startedAt: new Date().toISOString(),
          },
        }

        await session.save()

        await logAction(sql, {
          actorId: Number(adminUser?.sub ?? 0),
          action: AuditActions.IMPERSONATE_START,
          targetId: targetUser.id,
          details: {
            targetUsername: targetUser.username,
            targetRole: targetUser.role,
          },
          ipAddress: req.ip,
        }).catch((err) => {
          logger.warn('failed to log impersonation start', {
            operation: 'impersonateStart',
            error: err instanceof Error ? err.message : String(err),
          })
        })

        logger.info('impersonation started', {
          operation: 'impersonateStart',
          adminUserId: adminUser?.sub,
          targetUserId: targetUser.id,
          duration: Date.now() - start,
        })

        res.json({
          success: true,
          data: { ...claims, impersonatedBy: session.impersonation.impersonatedBy },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/admin/impersonate/end — stop impersonating
  router.post(
    '/api/admin/impersonate/end',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const session = await getHubSession<SessionData>(req, res, sessionSecret)

        if (!session.impersonation) {
          res.status(400).json({ success: false, error: 'Not currently impersonating' })
          return
        }

        const { adminUserId, adminUsername, startedAt } = session.impersonation.impersonatedBy
        const targetUserId = session.impersonation.targetUserId

        // Real impersonation span (startedAt is set when impersonation began),
        // not the duration of this request
        const durationMs = Math.max(0, Date.now() - new Date(startedAt).getTime())

        // Clear impersonation data but keep admin's original tokens
        delete session.impersonation
        await session.save()

        await logAction(sql, {
          actorId: adminUserId,
          action: AuditActions.IMPERSONATE_END,
          targetId: targetUserId,
          details: {
            adminUsername,
            startedAt,
            durationSeconds: Math.round(durationMs / 1000),
          },
          ipAddress: req.ip,
        }).catch((err) => {
          logger.warn('failed to log impersonation end', {
            operation: 'impersonateEnd',
            error: err instanceof Error ? err.message : String(err),
          })
        })

        logger.info('impersonation ended', {
          operation: 'impersonateEnd',
          adminUserId,
          targetUserId,
          durationSeconds: Math.round(durationMs / 1000),
        })

        res.json({ success: true })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}

/**
 * Middleware that blocks write operations during impersonation.
 * Must be mounted AFTER `createRequireAuth()` so `res.locals.user` is populated.
 * Allows the impersonation end endpoint so admins can always exit.
 */
export function blockWriteDuringImpersonation(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = res.locals.user as { isImpersonating?: boolean } | undefined

  if (!user?.isImpersonating) {
    next()
    return
  }

  // Allow read-only operations
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next()
    return
  }

  // Allow the impersonation end endpoint
  if (req.method === 'POST' && req.path === '/api/admin/impersonate/end') {
    next()
    return
  }

  res.status(403).json({
    success: false,
    error: 'Read-only mode: actions are disabled during impersonation',
  })
}
