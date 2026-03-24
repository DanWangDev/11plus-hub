import { Router } from 'express'
import type { Request, Response } from 'express'
import { ZodError } from 'zod'
import { db } from '../db/connection.js'
import { createLogger } from '../lib/logger.js'
import {
  findUserById,
  updateUser,
  listUsers,
  countUsers,
  listUsersSchema,
  updateUserSchema,
} from '../services/user-service.js'
import type postgres from 'postgres'

interface UsersRouterOptions {
  sql?: postgres.Sql
}

export function createUsersRouter(options: UsersRouterOptions = {}): Router {
  const router = Router()
  const sql = options.sql ?? db
  const logger = createLogger({ route: 'users' })

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

  return router
}
