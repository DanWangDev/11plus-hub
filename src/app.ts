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
import { createHubAuthRouter, type HubAuthOptions } from './routes/hub-auth.js'
import { createSecretAuthMiddleware } from './oidc/secret-auth-middleware.js'
import { apiLimiter } from './middleware/rate-limit.js'

export interface AppOptions {
  skipDbCheck?: boolean
  sql?: postgres.Sql
  oidcProvider?: Provider
  frontendDir?: string
  hubAuth?: HubAuthOptions
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express()

  // Security & parsing
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': [
            "'self'",
            'https://challenges.cloudflare.com',
            'https://accounts.google.com',
          ],
          'frame-src': [
            "'self'",
            'https://challenges.cloudflare.com',
            'https://accounts.google.com',
          ],
          'connect-src': ["'self'", 'https://accounts.google.com'],
          'form-action': ["'self'", 'http://localhost:*', 'https://*.labf.app'],
        },
      },
    }),
  )
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
    // Hash incoming client_secret before oidc-provider sees it (IdentityServer pattern)
    app.use('/oidc/token', createSecretAuthMiddleware())
    app.use('/oidc', options.oidcProvider.callback())
  }

  // Hub's own OIDC client routes (login/callback/logout/me/backchannel-logout)
  if (options.hubAuth) {
    app.use(createHubAuthRouter(options.hubAuth))
  }

  // Serve frontend SPA in production
  if (options.frontendDir) {
    app.use(express.static(options.frontendDir))
    // OIDC discovery redirect: provider is mounted at /oidc but issuer is the root
    app.get('/.well-known/openid-configuration', (_req, res) => {
      res.redirect(301, '/oidc/.well-known/openid-configuration')
    })
    // SPA fallback: serve index.html for non-API, non-OIDC routes
    app.get('{*path}', (req, res, next) => {
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/oidc/') ||
        req.path.startsWith('/health') ||
        req.path.startsWith('/ready') ||
        req.path.startsWith('/auth/') ||
        req.path.startsWith('/.well-known/')
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
