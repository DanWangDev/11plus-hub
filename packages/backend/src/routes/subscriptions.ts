import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { db } from '../db/connection.js'
import { AppError } from '../middleware/error-handler.js'
import { createLogger } from '../lib/logger.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import {
  createSubscription,
  findSubscriptionById,
  updateSubscription,
  cancelSubscription,
  listSubscriptions,
  countSubscriptions,
  getUserAppAccess,
  grantAppAccess,
  revokeAppAccess,
  checkEntitlement,
  createSubscriptionSchema,
  updateSubscriptionSchema,
  listSubscriptionsSchema,
} from '../services/subscription-service.js'
import type postgres from 'postgres'

function getActorId(req: Request): number | null {
  const header = req.headers['x-user-id']
  const id = Number(header)
  return Number.isFinite(id) && id > 0 ? id : null
}

interface SubscriptionsRouterOptions {
  sql?: postgres.Sql
}

export function createSubscriptionsRouter(options: SubscriptionsRouterOptions = {}): Router {
  const router = Router()
  const sql = options.sql ?? db
  const logger = createLogger({ route: 'subscriptions' })

  // POST /api/subscriptions — create subscription
  router.post('/api/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      const data = createSubscriptionSchema.parse(req.body)

      logger.info('creating subscription', {
        operation: 'createSubscription',
        userId: data.userId,
      })

      const subscription = await createSubscription(sql, data)

      logger.info('subscription created', {
        operation: 'createSubscription',
        subscriptionId: subscription.id,
        userId: data.userId,
        duration: Date.now() - start,
      })

      await logAction(sql, {
        actorId: getActorId(req),
        action: AuditActions.SUBSCRIPTION_CREATE,
        targetId: data.userId,
        details: { subscriptionId: subscription.id, plan: data.plan },
        ipAddress: req.ip,
      }).catch(() => {})

      res.status(201).json({
        success: true,
        data: subscription,
      })
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn('create subscription validation failed', {
          operation: 'createSubscription',
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
  })

  // GET /api/subscriptions — list subscriptions with filters
  router.get('/api/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      const filters = listSubscriptionsSchema.parse(req.query)
      const [subscriptions, total] = await Promise.all([
        listSubscriptions(sql, filters),
        countSubscriptions(sql, filters),
      ])

      logger.info('subscriptions listed', {
        operation: 'listSubscriptions',
        total,
        page: filters.page,
        limit: filters.limit,
        duration: Date.now() - start,
      })

      res.json({
        success: true,
        data: subscriptions,
        meta: {
          total,
          page: filters.page,
          limit: filters.limit,
        },
      })
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn('list subscriptions validation failed', {
          operation: 'listSubscriptions',
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
  })

  // GET /api/subscriptions/:id — get subscription by ID
  router.get('/api/subscriptions/:id', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      const id = Number(req.params.id)
      if (Number.isNaN(id) || id <= 0) {
        throw new AppError(400, 'Invalid subscription ID')
      }

      logger.info('finding subscription', {
        operation: 'findSubscriptionById',
        subscriptionId: id,
      })

      const subscription = await findSubscriptionById(sql, id)
      if (!subscription) {
        throw new AppError(404, 'Subscription not found')
      }

      logger.info('subscription found', {
        operation: 'findSubscriptionById',
        subscriptionId: id,
        duration: Date.now() - start,
      })

      res.json({
        success: true,
        data: subscription,
      })
    } catch (error) {
      next(error)
    }
  })

  // PATCH /api/subscriptions/:id — update subscription
  router.patch(
    '/api/subscriptions/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const id = Number(req.params.id)
        if (Number.isNaN(id) || id <= 0) {
          throw new AppError(400, 'Invalid subscription ID')
        }

        const data = updateSubscriptionSchema.parse(req.body)

        logger.info('updating subscription', {
          operation: 'updateSubscription',
          subscriptionId: id,
        })

        const subscription = await updateSubscription(sql, id, data)
        if (!subscription) {
          throw new AppError(404, 'Subscription not found')
        }

        logger.info('subscription updated', {
          operation: 'updateSubscription',
          subscriptionId: id,
          duration: Date.now() - start,
        })

        await logAction(sql, {
          actorId: getActorId(req),
          action: AuditActions.SUBSCRIPTION_UPDATE,
          targetId: subscription.user_id,
          details: { subscriptionId: id, fields: Object.keys(data) },
          ipAddress: req.ip,
        }).catch(() => {})

        res.json({
          success: true,
          data: subscription,
        })
      } catch (error) {
        if (error instanceof ZodError) {
          logger.warn('update subscription validation failed', {
            operation: 'updateSubscription',
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

  // DELETE /api/subscriptions/:id — cancel subscription
  router.delete(
    '/api/subscriptions/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const id = Number(req.params.id)
        if (Number.isNaN(id) || id <= 0) {
          throw new AppError(400, 'Invalid subscription ID')
        }

        logger.info('cancelling subscription', {
          operation: 'cancelSubscription',
          subscriptionId: id,
        })

        const subscription = await cancelSubscription(sql, id)
        if (!subscription) {
          throw new AppError(404, 'Subscription not found')
        }

        logger.info('subscription cancelled', {
          operation: 'cancelSubscription',
          subscriptionId: id,
          duration: Date.now() - start,
        })

        await logAction(sql, {
          actorId: getActorId(req),
          action: AuditActions.SUBSCRIPTION_CANCEL,
          targetId: subscription.user_id,
          details: { subscriptionId: id },
          ipAddress: req.ip,
        }).catch(() => {})

        res.json({
          success: true,
          data: subscription,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // GET /api/users/:userId/entitlements — get user's app access list
  router.get(
    '/api/users/:userId/entitlements',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const userId = Number(req.params.userId)
        if (Number.isNaN(userId) || userId <= 0) {
          throw new AppError(400, 'Invalid user ID')
        }

        logger.info('getting user entitlements', {
          operation: 'getUserAppAccess',
          userId,
        })

        const access = await getUserAppAccess(sql, userId)

        logger.info('user entitlements retrieved', {
          operation: 'getUserAppAccess',
          userId,
          count: access.length,
          duration: Date.now() - start,
        })

        res.json({
          success: true,
          data: access,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/users/:userId/entitlements/:appId — grant app access
  router.post(
    '/api/users/:userId/entitlements/:appId',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const userId = Number(req.params.userId)
        const appId = Number(req.params.appId)

        if (Number.isNaN(userId) || userId <= 0) {
          throw new AppError(400, 'Invalid user ID')
        }
        if (Number.isNaN(appId) || appId <= 0) {
          throw new AppError(400, 'Invalid app ID')
        }

        logger.info('granting app access', {
          operation: 'grantAppAccess',
          userId,
          appId,
        })

        const access = await grantAppAccess(sql, userId, appId)

        logger.info('app access granted', {
          operation: 'grantAppAccess',
          userId,
          appId,
          duration: Date.now() - start,
        })

        await logAction(sql, {
          actorId: getActorId(req),
          action: AuditActions.APP_ACCESS_GRANT,
          targetId: userId,
          details: { appId },
          ipAddress: req.ip,
        }).catch(() => {})

        res.status(201).json({
          success: true,
          data: access,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // DELETE /api/users/:userId/entitlements/:appId — revoke app access
  router.delete(
    '/api/users/:userId/entitlements/:appId',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const userId = Number(req.params.userId)
        const appId = Number(req.params.appId)

        if (Number.isNaN(userId) || userId <= 0) {
          throw new AppError(400, 'Invalid user ID')
        }
        if (Number.isNaN(appId) || appId <= 0) {
          throw new AppError(400, 'Invalid app ID')
        }

        logger.info('revoking app access', {
          operation: 'revokeAppAccess',
          userId,
          appId,
        })

        const revoked = await revokeAppAccess(sql, userId, appId)
        if (!revoked) {
          throw new AppError(404, 'App access not found')
        }

        logger.info('app access revoked', {
          operation: 'revokeAppAccess',
          userId,
          appId,
          duration: Date.now() - start,
        })

        await logAction(sql, {
          actorId: getActorId(req),
          action: AuditActions.APP_ACCESS_REVOKE,
          targetId: userId,
          details: { appId },
          ipAddress: req.ip,
        }).catch(() => {})

        res.json({
          success: true,
          data: { revoked: true },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // GET /api/users/:userId/entitlements/:appSlug/check — check entitlement
  router.get(
    '/api/users/:userId/entitlements/:appSlug/check',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const userId = Number(req.params.userId)
        const appSlug = String(req.params.appSlug)

        if (Number.isNaN(userId) || userId <= 0) {
          throw new AppError(400, 'Invalid user ID')
        }
        if (!appSlug) {
          throw new AppError(400, 'Invalid app slug')
        }

        logger.info('checking entitlement', {
          operation: 'checkEntitlement',
          userId,
          appSlug,
        })

        const entitled = await checkEntitlement(sql, userId, appSlug)

        logger.info('entitlement checked', {
          operation: 'checkEntitlement',
          userId,
          appSlug,
          entitled,
          duration: Date.now() - start,
        })

        if (!entitled) {
          res.status(403).json({
            success: false,
            error: 'User does not have access to this application',
          })
          return
        }

        res.json({
          success: true,
          data: { entitled: true },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
