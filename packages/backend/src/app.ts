import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import type postgres from 'postgres'
import type Provider from 'oidc-provider'
import { requestId } from './middleware/request-id.js'
import { notFoundHandler, errorHandler } from './middleware/error-handler.js'
import { createRequireAuth, requireAdmin } from './middleware/auth.js'
import { createHealthRouter } from './routes/health.js'
import { createAuthRouter } from './routes/auth.js'
import { createUsersRouter } from './routes/users.js'
import { createApplicationsRouter } from './routes/applications.js'
import { createAuditRouter } from './routes/audit.js'
import { createSubscriptionsRouter } from './routes/subscriptions.js'
import { createInteractionRouter } from './routes/oidc-interactions.js'
import { createPasswordResetRouter } from './routes/password-reset.js'
import { createHubAuthRouter, type HubAuthOptions } from './routes/hub-auth.js'
import { createProfileRouter } from './routes/profile.js'
import { createSecretAuthMiddleware } from './oidc/secret-auth-middleware.js'
import { apiLimiter } from './middleware/rate-limit.js'
import { createStripeWebhookRouter, type StripeWebhookOptions } from './routes/stripe-webhook.js'
import { createStripeCheckoutRouter, type StripeCheckoutOptions } from './routes/stripe-checkout.js'
import { createEntitlementRouter } from './routes/entitlement.js'

export interface AppOptions {
  skipDbCheck?: boolean
  sql?: postgres.Sql
  oidcProvider?: Provider
  hubAuth?: HubAuthOptions
  stripeWebhook?: StripeWebhookOptions
  stripeCheckout?: StripeCheckoutOptions
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express()

  // Trust proxy headers (Cloudflare tunnel, Docker reverse proxies)
  // Required so Express reports correct protocol (https) and client IP
  app.set('trust proxy', true)

  // Security & parsing
  // Skip Helmet CSP for /oidc/ paths — oidc-provider renders its own pages
  // (logout confirmation, error) with inline scripts and form submissions
  // that conflict with the SPA's strict CSP. The provider sets its own
  // security headers via logoutSource/postLogoutSuccessSource callbacks.
  const helmetWithCsp = helmet({
    // Allow popups to retain their opener reference so Google Identity
    // Services can poll popupWindow.closed and postMessage back the token.
    // Without this, COOP: same-origin severs the link and GIS immediately
    // fires error_callback with popup_closed.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': [
          "'self'",
          'https://challenges.cloudflare.com',
          'https://accounts.google.com',
        ],
        'frame-src': ["'self'", 'https://challenges.cloudflare.com', 'https://accounts.google.com'],
        'connect-src': ["'self'", 'https://accounts.google.com'],
        'form-action': ["'self'", 'http://localhost:*', 'https://*.labf.app'],
      },
    },
  })
  // OIDC routes need 'unsafe-inline' for oidc-provider's auto-submit logout
  // form and error pages, but we still apply CSP (rather than disabling it entirely)
  const helmetOidcCsp = helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'"],
        'form-action': ["'self'", 'http://localhost:*', 'https://*.labf.app'],
      },
    },
  })
  app.use((req, res, next) => {
    if (req.path.startsWith('/oidc/')) {
      return helmetOidcCsp(req, res, next)
    }
    return helmetWithCsp(req, res, next)
  })
  // Restrict CORS to the hub's own origin + registered client origins.
  // oidc-provider handles /oidc/ CORS separately via clientBasedCORS.
  const hubOrigin = options.hubAuth ? new URL(options.hubAuth.issuer).origin : undefined
  const corsAllowedOrigins = new Set<string>([
    ...(hubOrigin ? [hubOrigin] : []),
    // Dev origins
    ...(process.env.NODE_ENV !== 'production'
      ? ['http://localhost:3009', 'http://localhost:5173']
      : []),
  ])
  app.use(
    cors({
      origin(origin, callback) {
        // Allow requests with no origin (same-origin, server-to-server, curl)
        if (!origin || corsAllowedOrigins.has(origin)) {
          callback(null, true)
          return
        }
        // Allow *.labf.app subdomains (child apps on NAS or cloud)
        try {
          const hostname = new URL(origin).hostname
          if (hostname.endsWith('.labf.app')) {
            callback(null, true)
            return
          }
        } catch {
          // Invalid origin URL, fall through to reject
        }
        callback(null, false)
      },
      credentials: true,
    }),
  )
  app.use(compression())
  app.use(cookieParser())

  // Stripe webhook route — mounted BEFORE express.json() because Stripe
  // signature verification requires the raw request body. Also exempt from
  // rate limiting (Stripe controls the rate of webhook deliveries).
  if (options.stripeWebhook) {
    app.use(createStripeWebhookRouter(options.stripeWebhook))
  }

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))

  // Request ID tracking
  app.use(requestId)

  // Rate limiting
  app.use('/api', apiLimiter)

  // Routes — public
  app.use(createHealthRouter({ skipDbCheck: options.skipDbCheck }))
  app.use(createAuthRouter({ sql: options.sql }))
  app.use(createPasswordResetRouter({ sql: options.sql }))
  if (options.sql) {
    app.use(createEntitlementRouter({ sql: options.sql }))
  }

  // Routes — admin-only (require authenticated admin session)
  if (options.hubAuth) {
    const requireAuth = createRequireAuth(options.hubAuth.sessionSecret)
    app.use('/api/profile', requireAuth)
    app.use('/api/users', requireAuth, requireAdmin)
    // GET /api/apps is readable by any authenticated user (student dashboard needs it)
    // Write operations (POST/PATCH/DELETE) require admin
    app.use('/api/apps', requireAuth, (req, res, next) => {
      if (req.method === 'GET') return next()
      requireAdmin(req, res, next)
    })
    app.use('/api/subscriptions', requireAuth, requireAdmin)
    app.use('/api/audit', requireAuth, requireAdmin)
    // Stripe checkout/portal — any authenticated user can create checkout sessions
    if (options.stripeCheckout) {
      app.use('/api/stripe/checkout', requireAuth)
      app.use('/api/stripe/portal', requireAuth)
    }
  }
  if (options.hubAuth) {
    app.use(createProfileRouter({ sql: options.sql, sessionSecret: options.hubAuth.sessionSecret }))
  }
  app.use(createUsersRouter({ sql: options.sql }))
  app.use(createApplicationsRouter())
  app.use(createSubscriptionsRouter({ sql: options.sql }))
  app.use(createAuditRouter({ sql: options.sql }))
  if (options.stripeCheckout) {
    app.use(createStripeCheckoutRouter(options.stripeCheckout))
  }

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

  // Hub's own OIDC client routes (hub-login/hub-callback/hub-logout/me/backchannel-logout)
  if (options.hubAuth) {
    app.use(createHubAuthRouter(options.hubAuth))
  }

  // OIDC discovery redirect: provider is mounted at /oidc but issuer is the root
  app.get('/.well-known/openid-configuration', (_req, res) => {
    res.redirect(301, '/oidc/.well-known/openid-configuration')
  })

  // Error handling
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
