import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { db } from '../db/connection.js'
import { AppError } from '../middleware/error-handler.js'
import { createLogger } from '../lib/logger.js'
import {
  getAuditLogs,
  countAuditLogs,
  getAuditLogById,
  getActorHistory,
  listAuditLogsSchema,
} from '../services/audit-service.js'
import type postgres from 'postgres'

interface AuditRouterOptions {
  sql?: postgres.Sql
}

export function createAuditRouter(options: AuditRouterOptions = {}): Router {
  const router = Router()
  const sql = options.sql ?? db
  const logger = createLogger({ route: 'audit' })

  // GET /api/audit — list audit logs with filters (admin only — stub for now)
  router.get('/api/audit', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      const filters = listAuditLogsSchema.parse(req.query)
      const [logs, total] = await Promise.all([
        getAuditLogs(sql, filters),
        countAuditLogs(sql, filters),
      ])

      logger.info('audit logs listed', {
        operation: 'getAuditLogs',
        total,
        page: filters.page,
        limit: filters.limit,
        duration: Date.now() - start,
      })

      res.json({
        success: true,
        data: logs,
        meta: {
          total,
          page: filters.page,
          limit: filters.limit,
        },
      })
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn('list audit logs validation failed', {
          operation: 'getAuditLogs',
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

  // GET /api/audit/:id — get single audit log entry
  router.get('/api/audit/:id', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      const id = Number(req.params.id)

      if (Number.isNaN(id) || id <= 0) {
        throw new AppError(400, 'Invalid audit log ID')
      }

      const entry = await getAuditLogById(sql, id)

      if (!entry) {
        logger.warn('audit log entry not found', {
          operation: 'getAuditLogById',
          targetId: id,
          duration: Date.now() - start,
        })
        throw new AppError(404, 'Audit log entry not found')
      }

      logger.info('audit log entry retrieved', {
        operation: 'getAuditLogById',
        targetId: id,
        duration: Date.now() - start,
      })

      res.json({
        success: true,
        data: entry,
      })
    } catch (error) {
      next(error)
    }
  })

  // GET /api/audit/actor/:actorId — get audit trail for a specific user
  router.get(
    '/api/audit/actor/:actorId',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const actorId = Number(req.params.actorId)

        if (Number.isNaN(actorId) || actorId <= 0) {
          throw new AppError(400, 'Invalid actor ID')
        }

        const filters = listAuditLogsSchema.parse(req.query)
        const logs = await getActorHistory(sql, actorId, filters)

        logger.info('actor history retrieved', {
          operation: 'getActorHistory',
          actorId,
          count: logs.length,
          duration: Date.now() - start,
        })

        res.json({
          success: true,
          data: logs,
          meta: {
            page: filters.page,
            limit: filters.limit,
          },
        })
      } catch (error) {
        if (error instanceof ZodError) {
          logger.warn('actor history validation failed', {
            operation: 'getActorHistory',
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
