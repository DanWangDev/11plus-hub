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

export interface AppOptions {
  skipDbCheck?: boolean
  sql?: postgres.Sql
  oidcProvider?: Provider
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

  // Error handling
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
