import { Router } from 'express'
import type { Request, Response } from 'express'
import { ZodError } from 'zod'
import { db } from '../db/connection.js'
import { createLogger } from '../lib/logger.js'
import {
  createUser,
  createUserSchema,
  findUserById,
  softDeleteUser,
  updateUser,
  listUsers,
  countUsers,
  listUsersSchema,
  updateUserSchema,
} from '../services/user-service.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import type postgres from 'postgres'

function getActorId(req: Request): number | null {
  const header = req.headers['x-user-id']
  const id = Number(header)
  return Number.isFinite(id) && id > 0 ? id : null
}

interface UsersRouterOptions {
  sql?: postgres.Sql
}

export function createUsersRouter(options: UsersRouterOptions = {}): Router {
  const router = Router()
  const sql = options.sql ?? db
  const logger = createLogger({ route: 'users' })

  // POST /api/users — create user (admin)
  router.post('/api/users', async (req: Request, res: Response) => {
    const start = Date.now()
    try {
      const data = createUserSchema.parse(req.body)
      const user = await createUser(sql, data)

      logger.info('user created by admin', {
        operation: 'createUser',
        userId: user.id,
        duration: Date.now() - start,
      })

      await logAction(sql, {
        actorId: getActorId(req),
        action: AuditActions.REGISTER,
        targetId: user.id,
        details: { source: 'admin', username: user.username },
        ipAddress: req.ip,
      }).catch(() => {})

      res.status(201).json({
        success: true,
        data: user,
      })
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn('create user validation failed', {
          operation: 'createUser',
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
        logger.warn('create user duplicate conflict', {
          operation: 'createUser',
          duration: Date.now() - start,
        })
        res.status(409).json({
          success: false,
          error: 'User already exists',
        })
        return
      }

      logger.error('create user failed', {
        operation: 'createUser',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start,
      })
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      })
    }
  })

  router.get('/api/users', async (req: Request, res: Response) => {
    const start = Date.now()
    try {
      const filters = listUsersSchema.parse(req.query)
      const [users, total] = await Promise.all([listUsers(sql, filters), countUsers(sql, filters)])

      logger.info('users listed', {
        operation: 'listUsers',
        total,
        page: filters.page,
        limit: filters.limit,
        duration: Date.now() - start,
      })

      res.json({
        success: true,
        data: users,
        meta: {
          total,
          page: filters.page,
          limit: filters.limit,
        },
      })
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn('list users validation failed', {
          operation: 'listUsers',
          duration: Date.now() - start,
        })
        res.status(400).json({
          success: false,
          error: 'Validation failed',
        })
        return
      }

      logger.error('list users failed', {
        operation: 'listUsers',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start,
      })
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      })
    }
  })

  router.get('/api/users/:id', async (req: Request, res: Response) => {
    const start = Date.now()
    try {
      const id = Number(req.params.id)

      if (Number.isNaN(id) || id <= 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid user ID',
        })
        return
      }

      const user = await findUserById(sql, id)

      if (!user) {
        logger.warn('user not found', {
          operation: 'findUserById',
          targetId: id,
          duration: Date.now() - start,
        })
        res.status(404).json({
          success: false,
          error: 'User not found',
        })
        return
      }

      logger.info('user retrieved', {
        operation: 'findUserById',
        targetId: id,
        duration: Date.now() - start,
      })

      res.json({
        success: true,
        data: user,
      })
    } catch (error) {
      logger.error('get user failed', {
        operation: 'findUserById',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start,
      })
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      })
    }
  })

  router.patch('/api/users/:id', async (req: Request, res: Response) => {
    const start = Date.now()
    try {
      const id = Number(req.params.id)

      if (Number.isNaN(id) || id <= 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid user ID',
        })
        return
      }

      const data = updateUserSchema.parse(req.body)
      const user = await updateUser(sql, id, data)

      if (!user) {
        logger.warn('user not found for update', {
          operation: 'updateUser',
          targetId: id,
          duration: Date.now() - start,
        })
        res.status(404).json({
          success: false,
          error: 'User not found',
        })
        return
      }

      logger.info('user updated', {
        operation: 'updateUser',
        targetId: id,
        duration: Date.now() - start,
      })

      await logAction(sql, {
        actorId: getActorId(req),
        action: AuditActions.USER_UPDATE,
        targetId: id,
        details: { fields: Object.keys(data) },
        ipAddress: req.ip,
      }).catch(() => {})

      res.json({
        success: true,
        data: user,
      })
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn('update user validation failed', {
          operation: 'updateUser',
          duration: Date.now() - start,
        })
        res.status(400).json({
          success: false,
          error: 'Validation failed',
        })
        return
      }

      logger.error('update user failed', {
        operation: 'updateUser',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start,
      })
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      })
    }
  })

  // DELETE /api/users/:id — soft delete user
  router.delete('/api/users/:id', async (req: Request, res: Response) => {
    const start = Date.now()
    try {
      const id = Number(req.params.id)

      if (Number.isNaN(id) || id <= 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid user ID',
        })
        return
      }

      const user = await softDeleteUser(sql, id)

      if (!user) {
        logger.warn('user not found for delete', {
          operation: 'softDeleteUser',
          targetId: id,
          duration: Date.now() - start,
        })
        res.status(404).json({
          success: false,
          error: 'User not found',
        })
        return
      }

      logger.info('user soft-deleted', {
        operation: 'softDeleteUser',
        targetId: id,
        duration: Date.now() - start,
      })

      await logAction(sql, {
        actorId: getActorId(req),
        action: AuditActions.USER_DELETE,
        targetId: id,
        details: { username: user.username },
        ipAddress: req.ip,
      }).catch(() => {})

      res.json({
        success: true,
        data: user,
      })
    } catch (error) {
      logger.error('delete user failed', {
        operation: 'softDeleteUser',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start,
      })
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      })
    }
  })

  return router
}
