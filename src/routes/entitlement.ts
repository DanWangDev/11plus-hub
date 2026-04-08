import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import type postgres from 'postgres'
import { verifyServiceToken } from '../services/app-service.js'
import { checkEntitlement } from '../services/subscription-service.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'entitlement-api' })

export interface EntitlementRouterOptions {
  sql: postgres.Sql
}

/**
 * REST endpoint for child apps to verify user entitlement.
 *
 * GET /api/entitlement?user_id=42
 * Authorization: Bearer <service-token>
 *
 * Returns { entitled: boolean, app_slug: string }
 */
export function createEntitlementRouter(options: EntitlementRouterOptions): Router {
  const router = Router()
  const { sql } = options

  router.get(
    '/api/entitlement',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Extract bearer token
        const authHeader = req.headers.authorization
        if (!authHeader?.startsWith('Bearer ')) {
          res.status(401).json({ success: false, error: 'Missing service token' })
          return
        }
        const token = authHeader.slice(7)

        // Verify service token and get associated app
        const serviceToken = await verifyServiceToken(sql, token)
        if (!serviceToken) {
          res.status(401).json({ success: false, error: 'Invalid or expired service token' })
          return
        }

        // Get app slug from the service token's app
        const apps = await sql<{ slug: string }[]>`
          SELECT slug FROM applications WHERE id = ${serviceToken.app_id}
        `
        const appSlug = apps[0]?.slug
        if (!appSlug) {
          res.status(401).json({ success: false, error: 'Application not found' })
          return
        }

        // Validate user_id param
        const userId = Number(req.query.user_id)
        if (!Number.isFinite(userId) || userId <= 0) {
          res.status(400).json({ success: false, error: 'Valid user_id query parameter required' })
          return
        }

        const entitled = await checkEntitlement(sql, userId, appSlug)

        logger.info('entitlement check via API', {
          operation: 'checkEntitlementApi',
          userId,
          appSlug,
          entitled,
        })

        res.json({
          success: true,
          data: {
            entitled,
            app_slug: appSlug,
            user_id: userId,
          },
        })
      } catch (error) {
        logger.error('entitlement check failed', {
          operation: 'checkEntitlementApi',
          error: error instanceof Error ? error.message : String(error),
        })
        next(error)
      }
    },
  )

  return router
}
