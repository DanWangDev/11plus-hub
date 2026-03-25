import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import type Provider from 'oidc-provider'
import type postgres from 'postgres'
import { findUserByEmail, verifyPassword } from '../services/user-service.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ route: 'oidc-interactions' })

interface InteractionRouterOptions {
  provider: Provider
  sql: postgres.Sql
}

export function createInteractionRouter(options: InteractionRouterOptions): Router {
  const { provider, sql } = options
  const router = Router()

  // GET /api/auth/interaction/:uid — JSON API for SPA
  router.get(
    '/api/auth/interaction/:uid',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const interactionDetails = await provider.interactionDetails(req, res)
        const { prompt, params } = interactionDetails
        const clientId = String((params as Record<string, unknown>).client_id ?? '')

        logger.info('interaction details requested (JSON)', {
          operation: 'interactionDetailsJson',
          promptName: prompt.name,
          clientId,
          duration: Date.now() - start,
        })

        let clientName = clientId
        if (prompt.name === 'consent') {
          const client = await provider.Client.find(clientId)
          clientName = client?.metadata().client_name ?? clientId
        }

        res.json({
          prompt: {
            name: prompt.name,
            details: prompt.details,
          },
          params: {
            client_id: clientId,
            scope: String((params as Record<string, unknown>).scope ?? ''),
            redirect_uri: String((params as Record<string, unknown>).redirect_uri ?? ''),
          },
          session: interactionDetails.session
            ? { accountId: interactionDetails.session.accountId }
            : undefined,
          uid: String(req.params.uid),
          client: { name: clientName },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/auth/interaction/:uid/login — JSON API login for SPA
  router.post(
    '/api/auth/interaction/:uid/login',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const { email, password } = req.body as {
          email?: string
          password?: string
        }

        if (!email || !password) {
          res.status(400).json({
            success: false,
            error: 'Email and password are required',
          })
          return
        }

        const user = await findUserByEmail(sql, email)
        if (!user || !user.password_hash) {
          logger.warn('oidc api login failed - user not found', {
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
          logger.warn('oidc api login failed - wrong password', {
            operation: 'login',
            userId: user.id,
            duration: Date.now() - start,
          })

          await logAction(sql, {
            actorId: user.id,
            action: AuditActions.LOGIN_FAILED,
            ipAddress: req.ip,
          }).catch(() => {})

          res.status(401).json({
            success: false,
            error: 'Invalid credentials',
          })
          return
        }

        logger.info('oidc api login success', {
          operation: 'login',
          userId: user.id,
          duration: Date.now() - start,
        })

        await logAction(sql, {
          actorId: user.id,
          action: AuditActions.LOGIN,
          ipAddress: req.ip,
        }).catch(() => {})

        const result = {
          login: {
            accountId: String(user.id),
          },
        }

        await provider.interactionFinished(req, res, result, {
          mergeWithLastSubmission: false,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/auth/interaction/:uid/confirm — JSON API consent for SPA
  router.post(
    '/api/auth/interaction/:uid/confirm',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const interactionDetails = await provider.interactionDetails(req, res)
        const {
          prompt: { details },
          params,
          session,
        } = interactionDetails

        const accountId = session?.accountId

        logger.info('oidc api consent granted', {
          operation: 'consent',
          accountId,
          clientId: (params as Record<string, unknown>).client_id,
          duration: Date.now() - start,
        })

        let grant = interactionDetails.grantId
          ? await provider.Grant.find(interactionDetails.grantId)
          : undefined

        if (!grant) {
          grant = new provider.Grant({
            accountId: accountId ?? '',
            clientId: (params as Record<string, unknown>).client_id as string,
          })
        }

        const missingScopes = (details as Record<string, unknown>).missingOIDCScope as
          | string[]
          | undefined
        if (missingScopes) {
          grant.addOIDCScope(missingScopes.join(' '))
        }

        const missingClaims = (details as Record<string, unknown>).missingOIDCClaims as
          | string[]
          | undefined
        if (missingClaims) {
          grant.addOIDCClaims(missingClaims)
        }

        const missingResourceScopes = (details as Record<string, unknown>).missingResourceScopes as
          | Record<string, string[]>
          | undefined
        if (missingResourceScopes) {
          for (const [indicator, scopes] of Object.entries(missingResourceScopes)) {
            grant.addResourceScope(indicator, scopes.join(' '))
          }
        }

        const grantId = await grant.save()

        const consent: Record<string, unknown> = {}
        if (!interactionDetails.grantId) {
          consent.grantId = grantId
        }

        const result = { consent }
        await provider.interactionFinished(req, res, result, {
          mergeWithLastSubmission: true,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/auth/interaction/:uid/abort — JSON API abort for SPA
  router.post(
    '/api/auth/interaction/:uid/abort',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        logger.info('oidc api interaction aborted', {
          operation: 'abort',
          uid: String(req.params.uid),
        })

        const result = {
          error: 'access_denied',
          error_description: 'User aborted the interaction',
        }

        await provider.interactionFinished(req, res, result, {
          mergeWithLastSubmission: false,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // GET /auth/interaction/:uid — render login/consent page (HTML fallback)
  router.get('/auth/interaction/:uid', async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    try {
      const uid = String(req.params.uid)
      const interactionDetails = await provider.interactionDetails(req, res)
      const { prompt, params } = interactionDetails
      const clientId = String((params as Record<string, unknown>).client_id ?? '')

      logger.info('interaction started', {
        operation: 'interactionDetails',
        uid,
        promptName: prompt.name,
        clientId,
      })

      if (prompt.name === 'login') {
        res.type('html')
        res.send(renderLoginPage(uid, clientId))
        return
      }

      if (prompt.name === 'consent') {
        const client = await provider.Client.find(clientId)

        res.type('html')
        res.send(
          renderConsentPage(
            uid,
            client?.metadata().client_name ?? clientId,
            String((params as Record<string, unknown>).scope ?? ''),
          ),
        )
        return
      }

      logger.warn('unknown interaction prompt', {
        operation: 'interactionDetails',
        promptName: prompt.name,
        duration: Date.now() - start,
      })
      res.status(400).send('Unknown interaction')
    } catch (error) {
      next(error)
    }
  })

  // POST /auth/interaction/:uid/login — handle login form submission
  router.post(
    '/auth/interaction/:uid/login',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const uid = String(req.params.uid)
        const { email, password } = req.body as {
          email?: string
          password?: string
        }

        if (!email || !password) {
          res.type('html')
          res.status(400).send(renderLoginPage(uid, '', 'Email and password are required'))
          return
        }

        const user = await findUserByEmail(sql, email)
        if (!user || !user.password_hash) {
          logger.warn('oidc login failed - user not found', {
            operation: 'login',
            duration: Date.now() - start,
          })
          res.type('html')
          res.status(401).send(renderLoginPage(uid, '', 'Invalid credentials'))
          return
        }

        const valid = await verifyPassword(password, user.password_hash)
        if (!valid) {
          logger.warn('oidc login failed - wrong password', {
            operation: 'login',
            userId: user.id,
            duration: Date.now() - start,
          })

          await logAction(sql, {
            actorId: user.id,
            action: AuditActions.LOGIN_FAILED,
            ipAddress: req.ip,
          }).catch(() => {})

          res.type('html')
          res.status(401).send(renderLoginPage(uid, '', 'Invalid credentials'))
          return
        }

        logger.info('oidc login success', {
          operation: 'login',
          userId: user.id,
          duration: Date.now() - start,
        })

        await logAction(sql, {
          actorId: user.id,
          action: AuditActions.LOGIN,
          ipAddress: req.ip,
        }).catch(() => {})

        const result = {
          login: {
            accountId: String(user.id),
          },
        }

        await provider.interactionFinished(req, res, result, {
          mergeWithLastSubmission: false,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /auth/interaction/:uid/confirm — handle consent confirmation
  router.post(
    '/auth/interaction/:uid/confirm',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      try {
        const interactionDetails = await provider.interactionDetails(req, res)
        const {
          prompt: { details },
          params,
          session,
        } = interactionDetails

        const accountId = session?.accountId

        logger.info('oidc consent granted', {
          operation: 'consent',
          accountId,
          clientId: (params as Record<string, unknown>).client_id,
          duration: Date.now() - start,
        })

        let grant = interactionDetails.grantId
          ? await provider.Grant.find(interactionDetails.grantId)
          : undefined

        if (!grant) {
          grant = new provider.Grant({
            accountId: accountId ?? '',
            clientId: (params as Record<string, unknown>).client_id as string,
          })
        }

        const missingScopes = (details as Record<string, unknown>).missingOIDCScope as
          | string[]
          | undefined
        if (missingScopes) {
          grant.addOIDCScope(missingScopes.join(' '))
        }

        const missingClaims = (details as Record<string, unknown>).missingOIDCClaims as
          | string[]
          | undefined
        if (missingClaims) {
          grant.addOIDCClaims(missingClaims)
        }

        const missingResourceScopes = (details as Record<string, unknown>).missingResourceScopes as
          | Record<string, string[]>
          | undefined
        if (missingResourceScopes) {
          for (const [indicator, scopes] of Object.entries(missingResourceScopes)) {
            grant.addResourceScope(indicator, scopes.join(' '))
          }
        }

        const grantId = await grant.save()

        const consent: Record<string, unknown> = {}
        if (!interactionDetails.grantId) {
          consent.grantId = grantId
        }

        const result = { consent }
        await provider.interactionFinished(req, res, result, {
          mergeWithLastSubmission: true,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /auth/interaction/:uid/abort — abort interaction
  router.post(
    '/auth/interaction/:uid/abort',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        logger.info('oidc interaction aborted', {
          operation: 'abort',
          uid: String(req.params.uid),
        })

        const result = {
          error: 'access_denied',
          error_description: 'User aborted the interaction',
        }

        await provider.interactionFinished(req, res, result, {
          mergeWithLastSubmission: false,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}

// --- HTML Templates (minimal, to be replaced by React UI later) ---

function renderLoginPage(uid: string, clientId?: string, error?: string): string {
  const errorHtml = error
    ? `<div style="color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:12px;border-radius:8px;margin-bottom:16px;font-size:14px">${escapeHtml(error)}</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign In — Lab F</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#f8fafc;color:#334155;display:flex;justify-content:center;align-items:center;min-height:100vh}
    .card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:40px;width:100%;max-width:420px}
    h1{font-size:24px;font-weight:600;color:#0f172a;text-align:center;margin-bottom:4px}
    .subtitle{text-align:center;color:#64748b;font-size:14px;margin-bottom:24px}
    label{display:block;font-size:14px;font-weight:500;margin-bottom:4px;color:#334155}
    input{width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;margin-bottom:16px}
    input:focus{outline:none;border-color:#0ea5e9;box-shadow:0 0 0 3px rgba(14,165,233,.1)}
    button{width:100%;padding:12px;background:#0ea5e9;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
    button:hover{background:#0284c7}
    .client{text-align:center;color:#94a3b8;font-size:12px;margin-top:16px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign In</h1>
    <p class="subtitle">Your family's learning hub</p>
    ${errorHtml}
    <form method="post" action="/auth/interaction/${escapeHtml(uid)}/login">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required>
      <button type="submit">Sign in</button>
    </form>
    ${clientId ? `<p class="client">Signing in to ${escapeHtml(clientId)}</p>` : ''}
  </div>
</body>
</html>`
}

function renderConsentPage(uid: string, clientName: string, scope: string): string {
  const scopes = scope.split(' ').filter(Boolean)
  const scopeList = scopes.map((s) => `<li>${escapeHtml(s)}</li>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorize — Lab F</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#f8fafc;color:#334155;display:flex;justify-content:center;align-items:center;min-height:100vh}
    .card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:40px;width:100%;max-width:420px}
    h1{font-size:24px;font-weight:600;color:#0f172a;text-align:center;margin-bottom:8px}
    .info{text-align:center;color:#64748b;font-size:14px;margin-bottom:24px}
    ul{margin:0 0 24px 20px;font-size:14px;line-height:1.8}
    .actions{display:flex;gap:12px}
    button{flex:1;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
    .allow{background:#0ea5e9;color:#fff}
    .allow:hover{background:#0284c7}
    .deny{background:#f1f5f9;color:#64748b}
    .deny:hover{background:#e2e8f0}
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize</h1>
    <p class="info"><strong>${escapeHtml(clientName)}</strong> is requesting access to:</p>
    <ul>${scopeList}</ul>
    <div class="actions">
      <form method="post" action="/auth/interaction/${escapeHtml(uid)}/confirm" style="flex:1">
        <button type="submit" class="allow" style="width:100%">Allow</button>
      </form>
      <form method="post" action="/auth/interaction/${escapeHtml(uid)}/abort" style="flex:1">
        <button type="submit" class="deny" style="width:100%">Deny</button>
      </form>
    </div>
  </div>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
