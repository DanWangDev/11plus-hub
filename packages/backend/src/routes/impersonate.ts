import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import type postgres from 'postgres'
import { getIronSession } from 'iron-session'
import { createLogger } from '../lib/logger.js'
import { findUserById, hasPassword } from '../services/user-service.js'
import {
  findSubscriptionByUserId,
  getUserAppAccess,
  syncAppAccessFromPlan,
  PLAN_APP_SLUGS,
} from '../services/subscription-service.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import type { RequestHandler } from 'express'
import { COOKIE_NAME, type SessionData } from './hub-auth.js'

const logger = createLogger({ route: 'impersonate' })

interface ImpersonateRouterOptions {
  sql: postgres.Sql
  sessionSecret: string
  requireAuth: RequestHandler
  requireAdmin: RequestHandler
}

async function buildUserClaims(
  sql: postgres.Sql,
  userId: number,
): Promise<Record<string, unknown>> {
  const user = await findUserById(sql, userId)
  if (!user) {
    throw new Error('User not found')
  }

  const subscription = await findSubscriptionByUserId(sql, user.id)
  const plan = subscription?.plan ?? 'free'
  const expectedApps = PLAN_APP_SLUGS[plan] ?? []

  const appAccess = await getUserAppAccess(sql, user.id)
  const appIds = appAccess.map((a) => a.app_id)
  let appSlugs: string[] = []
  if (appIds.length > 0) {
    const apps = await sql<{ slug: string }[]>`
      SELECT slug FROM applications WHERE id = ANY(${appIds})
    `
    appSlugs = apps.map((a) => a.slug)
  }

  // Auto-sync stale access
  const missing = expectedApps.filter((slug) => !appSlugs.includes(slug))
  const extra = appSlugs.filter((slug) => !expectedApps.includes(slug))
  if (missing.length > 0 || extra.length > 0) {
    logger.info('auto-syncing stale user_app_access during impersonation', {
      operation: 'impersonate',
      userId: user.id,
      plan,
      missing,
      extra,
    })
    await syncAppAccessFromPlan(sql, user.id, plan)
    appSlugs = expectedApps
  }

  const userHasPassword = await hasPassword(sql, user.id)

  return {
    sub: String(user.id),
    username: user.username,
    display_name: user.display_name,
    email: user.email,
    email_verified: user.email_verified,
    role: user.role,
    plan,
    features: subscription?.features ?? [],
    apps: appSlugs,
    has_password: userHasPassword,
    expires_at: subscription?.expires_at ? new Date(subscription.expires_at).toISOString() : null,
  }
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

        const claims = await buildUserClaims(sql, targetUser.id)

        const session = await getIronSession<SessionData>(req, res, {
          password: sessionSecret,
          cookieName: COOKIE_NAME,
          cookieOptions: {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax' as const,
            path: '/',
            maxAge: 30 * 60, // 30 minutes for impersonation
          },
        })

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
      const start = Date.now()
      try {
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

        if (!session.impersonation) {
          res.status(400).json({ success: false, error: 'Not currently impersonating' })
          return
        }

        const { adminUserId, adminUsername } = session.impersonation.impersonatedBy
        const targetUserId = session.impersonation.targetUserId

        // Clear impersonation data but keep admin's original tokens
        delete session.impersonation
        await session.save()

        await logAction(sql, {
          actorId: adminUserId,
          action: AuditActions.IMPERSONATE_END,
          targetId: targetUserId,
          details: {
            adminUsername,
            duration: Date.now() - start,
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
          duration: Date.now() - start,
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
