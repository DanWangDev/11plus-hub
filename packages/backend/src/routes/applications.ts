import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { db } from '../db/connection.js'
import { AppError } from '../middleware/error-handler.js'
import { createLogger } from '../lib/logger.js'
import {
  createApplication,
  findApplicationById,
  updateApplication,
  softDeleteApplication,
  listApplications,
  rotateClientSecret,
  createServiceToken,
  revokeServiceToken,
} from '../services/app-service.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import { clearClientCache } from '../oidc/pg-adapter.js'

const logger = createLogger({ service: 'applications-route' })

function getActorId(req: Request): number | null {
  const header = req.headers['x-user-id']
  const id = Number(header)
  return Number.isFinite(id) && id > 0 ? id : null
}

function omitSecretHash<T extends { client_secret_hash?: string }>(
  app: T,
): Omit<T, 'client_secret_hash'> {
  const { client_secret_hash: _hash, ...rest } = app
  return rest
}

export function createApplicationsRouter(): Router {
  const router = Router()

  // POST /api/apps — register new application
  router.post('/api/apps', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      logger.info('Creating application', { operation: 'createApplication' })

      const result = await createApplication(db, req.body)

      logger.info('Application created', {
        operation: 'createApplication',
        appId: result.application.id,
        duration: Date.now() - start,
      })

      await logAction(db, {
        actorId: getActorId(req),
        action: AuditActions.APP_REGISTER,
        targetId: result.application.id,
        details: { name: result.application.name, slug: result.application.slug },
        ipAddress: req.ip,
      }).catch(() => {})

      res.status(201).json({
        success: true,
        data: {
          ...omitSecretHash(result.application),
          client_secret: result.clientSecret,
        },
      })
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        logger.warn('Duplicate application', {
          operation: 'createApplication',
          duration: Date.now() - start,
        })
        next(new AppError(409, 'Application with this slug or client_id already exists'))
        return
      }
      next(err)
    }
  })

  // GET /api/apps — list applications
  router.get('/api/apps', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      logger.info('Listing applications', { operation: 'listApplications' })

      const { applications, total } = await listApplications(db, req.query)
      const page = Number(req.query.page) || 1
      const limit = Number(req.query.limit) || 20

      logger.info('Applications listed', {
        operation: 'listApplications',
        total,
        duration: Date.now() - start,
      })

      res.json({
        success: true,
        data: applications.map(omitSecretHash),
        meta: { total, page, limit },
      })
    } catch (err) {
      next(err)
    }
  })

  // GET /api/apps/:id — get application by ID
  router.get('/api/apps/:id', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      const id = Number(req.params.id)
      if (Number.isNaN(id)) {
        throw new AppError(400, 'Invalid application ID')
      }

      logger.info('Finding application', { operation: 'findApplicationById', appId: id })

      const application = await findApplicationById(db, id)
      if (!application) {
        throw new AppError(404, 'Application not found')
      }

      logger.info('Application found', {
        operation: 'findApplicationById',
        appId: id,
        duration: Date.now() - start,
      })

      res.json({
        success: true,
        data: omitSecretHash(application),
      })
    } catch (err) {
      next(err)
    }
  })

  // PATCH /api/apps/:id — update application
  router.patch('/api/apps/:id', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      const id = Number(req.params.id)
      if (Number.isNaN(id)) {
        throw new AppError(400, 'Invalid application ID')
      }

      logger.info('Updating application', { operation: 'updateApplication', appId: id })

      const application = await updateApplication(db, id, req.body)
      if (!application) {
        throw new AppError(404, 'Application not found')
      }

      // Invalidate OIDC client cache so changes take effect immediately
      clearClientCache()

      logger.info('Application updated', {
        operation: 'updateApplication',
        appId: id,
        duration: Date.now() - start,
      })

      await logAction(db, {
        actorId: getActorId(req),
        action: AuditActions.APP_UPDATE,
        targetId: id,
        details: { fields: Object.keys(req.body) },
        ipAddress: req.ip,
      }).catch(() => {})

      res.json({
        success: true,
        data: omitSecretHash(application),
      })
    } catch (err) {
      next(err)
    }
  })

  // DELETE /api/apps/:id — soft delete application
  router.delete('/api/apps/:id', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      const id = Number(req.params.id)
      if (Number.isNaN(id)) {
        throw new AppError(400, 'Invalid application ID')
      }

      logger.info('Deleting application', { operation: 'softDeleteApplication', appId: id })

      const application = await softDeleteApplication(db, id)
      if (!application) {
        throw new AppError(404, 'Application not found')
      }

      logger.info('Application deleted', {
        operation: 'softDeleteApplication',
        appId: id,
        duration: Date.now() - start,
      })

      await logAction(db, {
        actorId: getActorId(req),
        action: AuditActions.APP_DELETE,
        targetId: id,
        details: { name: application.name, slug: application.slug },
        ipAddress: req.ip,
      }).catch(() => {})

      res.json({
        success: true,
        data: omitSecretHash(application),
      })
    } catch (err) {
      next(err)
    }
  })

  // POST /api/apps/:id/rotate-secret — rotate client secret
  router.post(
    '/api/apps/:id/rotate-secret',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const id = Number(req.params.id)
        if (Number.isNaN(id)) {
          throw new AppError(400, 'Invalid application ID')
        }

        logger.info('Rotating client secret', { operation: 'rotateClientSecret', appId: id })

        const result = await rotateClientSecret(db, id)
        if (!result) {
          throw new AppError(404, 'Application not found')
        }

        // Invalidate OIDC client cache so the new secret takes effect immediately
        clearClientCache()

        logger.info('Client secret rotated', {
          operation: 'rotateClientSecret',
          appId: id,
          duration: Date.now() - start,
        })

        res.json({
          success: true,
          data: {
            ...omitSecretHash(result.application),
            client_secret: result.clientSecret,
          },
        })
      } catch (err) {
        next(err)
      }
    },
  )

  // POST /api/apps/:id/service-tokens — create service token
  router.post(
    '/api/apps/:id/service-tokens',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const id = Number(req.params.id)
        if (Number.isNaN(id)) {
          throw new AppError(400, 'Invalid application ID')
        }

        const scopes = Array.isArray(req.body.scopes) ? (req.body.scopes as string[]) : []

        logger.info('Creating service token', { operation: 'createServiceToken', appId: id })

        const result = await createServiceToken(db, id, scopes)

        logger.info('Service token created', {
          operation: 'createServiceToken',
          appId: id,
          tokenId: result.serviceToken.id,
          duration: Date.now() - start,
        })

        res.status(201).json({
          success: true,
          data: {
            ...result.serviceToken,
            token: result.token,
          },
        })
      } catch (err) {
        next(err)
      }
    },
  )

  // DELETE /api/apps/:id/service-tokens/:tokenId — revoke service token
  router.delete(
    '/api/apps/:id/service-tokens/:tokenId',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const tokenId = Number(req.params.tokenId)
        if (Number.isNaN(tokenId)) {
          throw new AppError(400, 'Invalid token ID')
        }

        logger.info('Revoking service token', { operation: 'revokeServiceToken', tokenId })

        const revoked = await revokeServiceToken(db, tokenId)
        if (!revoked) {
          throw new AppError(404, 'Service token not found')
        }

        logger.info('Service token revoked', {
          operation: 'revokeServiceToken',
          tokenId,
          duration: Date.now() - start,
        })

        res.json({
          success: true,
          data: { revoked: true },
        })
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}
