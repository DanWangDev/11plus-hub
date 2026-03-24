import { join } from 'node:path'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import type postgres from 'postgres'
import type Provider from 'oidc-provider'
import { requestId } from './middleware/request-id.js'
import { notFoundHandler, errorHandler } from './middleware/error-handler.js'
import { createHealthRouter } from './routes/health.js'
import { createAuthRouter } from './routes/auth.js'
import { createUsersRouter } from './routes/users.js'
import { createApplicationsRouter } from './routes/applications.js'
import { createAuditRouter } from './routes/audit.js'
import { createSubscriptionsRouter } from './routes/subscriptions.js'
import { createInteractionRouter } from './routes/oidc-interactions.js'
import { createPasswordResetRouter } from './routes/password-reset.js'
import { apiLimiter } from './middleware/rate-limit.js'

export interface AppOptions {
  skipDbCheck?: boolean
  sql?: postgres.Sql
  oidcProvider?: Provider
  frontendDir?: string
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express()

  // Security & parsing
  app.use(helmet())
  app.use(cors())
  app.use(compression())
  app.use(cookieParser())
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))

  // Request ID tracking
  app.use(requestId)

  // Rate limiting
  app.use('/api', apiLimiter)

  // Routes
  app.use(createHealthRouter({ skipDbCheck: options.skipDbCheck }))
  app.use(createAuthRouter({ sql: options.sql }))
  app.use(createUsersRouter({ sql: options.sql }))
  app.use(createApplicationsRouter())
  app.use(createSubscriptionsRouter({ sql: options.sql }))
  app.use(createPasswordResetRouter({ sql: options.sql }))
  app.use(createAuditRouter({ sql: options.sql }))

  // OIDC Provider
  if (options.oidcProvider && options.sql) {
    app.use(
      createInteractionRouter({
        provider: options.oidcProvider,
        sql: options.sql,
      }),
    )
    app.use('/oidc', options.oidcProvider.callback())
  }

  // Serve frontend SPA in production
  if (options.frontendDir) {
    app.use(express.static(options.frontendDir))
    // SPA fallback: serve index.html for non-API, non-OIDC routes
    app.get('*', (req, res, next) => {
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/oidc/') ||
        req.path.startsWith('/health') ||
        req.path.startsWith('/ready') ||
        req.path.startsWith('/auth/interaction/')
      ) {
        next()
        return
      }
      res.sendFile(join(options.frontendDir!, 'index.html'))
    })
  }

  // Error handling
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
