import { Router } from 'express'
import type { Request, Response } from 'express'
import { ZodError } from 'zod'
import { db } from '../db/connection.js'
import { createLogger } from '../lib/logger.js'
import {
  createUser,
  createUserSchema,
  findUserByEmail,
  verifyPassword,
} from '../services/user-service.js'
import type postgres from 'postgres'

interface AuthRouterOptions {
  sql?: postgres.Sql
}

export function createAuthRouter(options: AuthRouterOptions = {}): Router {
  const router = Router()
  const sql = options.sql ?? db
  const logger = createLogger({ route: 'auth' })

  router.post('/api/auth/register', async (req: Request, res: Response) => {
    const start = Date.now()
    try {
      const data = createUserSchema.parse(req.body)
      const user = await createUser(sql, data)

      logger.info('user registered', {
        operation: 'register',
        userId: user.id,
        duration: Date.now() - start,
      })

      res.status(201).json({
        success: true,
        data: user,
      })
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn('registration validation failed', {
          operation: 'register',
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
        logger.warn('registration duplicate conflict', {
          operation: 'register',
          duration: Date.now() - start,
        })
        res.status(409).json({
          success: false,
          error: 'User already exists',
        })
        return
      }

      logger.error('registration failed', {
        operation: 'register',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start,
      })
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      })
    }
  })

  router.post('/api/auth/login', async (req: Request, res: Response) => {
    const start = Date.now()
    try {
      const { email, password } = req.body as {
        email?: string
        password?: string
      }

      if (!email || !password) {
        logger.warn('login missing credentials', {
          operation: 'login',
          duration: Date.now() - start,
        })
        res.status(400).json({
          success: false,
          error: 'Email and password are required',
        })
        return
      }

      const user = await findUserByEmail(sql, email)

      if (!user || !user.password_hash) {
        logger.warn('login failed - user not found or no password', {
          operation: 'login',
          duration: Date.now() - start,
        })
        res.status(401).json({
          success: false,
          error: 'Invalid credentials',
        })
        return
      }

      const valid = await verifyPassword(password, user.password_hash)

      if (!valid) {
        logger.warn('login failed - wrong password', {
          operation: 'login',
          userId: user.id,
          duration: Date.now() - start,
        })
        res.status(401).json({
          success: false,
          error: 'Invalid credentials',
        })
        return
      }

      const { password_hash: _, ...userWithoutPassword } = user

      logger.info('user logged in', {
        operation: 'login',
        userId: user.id,
        duration: Date.now() - start,
      })

      res.json({
        success: true,
        data: {
          user: userWithoutPassword,
          token: 'placeholder-jwt-token',
        },
      })
    } catch (error) {
      logger.error('login failed', {
        operation: 'login',
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
