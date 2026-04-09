import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import type Provider from 'oidc-provider'
import type postgres from 'postgres'
import {
  createUser,
  findUserByEmail,
  findUserByGoogleId,
  findUserByUsername,
  generateUniqueUsername,
  verifyPassword,
} from '../services/user-service.js'
import { verifyGoogleToken, isGoogleConfigured } from '../services/google-auth-service.js'
import { logAction, AuditActions } from '../services/audit-service.js'
import { checkUserEntitlement } from '../oidc/entitlement-check.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ route: 'oidc-interactions' })

/**
 * Uses provider.interactionResult() to get the redirect URL without sending
 * the response, then returns it as JSON so the SPA can do
 * `window.location.href = redirectTo`.
 *
 * provider.interactionFinished() writes directly to res.statusCode/setHeader
 * (bypassing Express's res.redirect), which causes fetch() to follow the
 * redirect chain and fail parsing HTML as JSON ("Unexpected token '<'").
 */
async function finishInteractionAsJson(
  provider: Provider,
  req: Request,
  res: Response,
  result: Record<string, unknown>,
  options: { mergeWithLastSubmission: boolean },
): Promise<void> {
  const redirectTo = await provider.interactionResult(req, res, result, options)

  res.json({ success: true, redirectTo })
}

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
        const { identifier, email, password } = req.body as {
          identifier?: string
          email?: string
          password?: string
        }

        const loginId = identifier ?? email
        if (!loginId || !password) {
          res.status(400).json({
            success: false,
            error: 'Email or username, and password are required',
          })
          return
        }

        const user = loginId.includes('@')
          ? await findUserByEmail(sql, loginId)
          : await findUserByUsername(sql, loginId)
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

        // Check entitlement before completing login
        const interactionDetails = await provider.interactionDetails(req, res)
        const clientId = String(
          (interactionDetails.params as Record<string, unknown>).client_id ?? '',
        )

        const entitlement = await checkUserEntitlement(sql, user.id, clientId)
        if (!entitlement.allowed) {
          logger.warn('oidc api login denied - no entitlement', {
            operation: 'login',
            userId: user.id,
            clientId,
            reason: entitlement.reason,
            duration: Date.now() - start,
          })

          await logAction(sql, {
            actorId: user.id,
            action: AuditActions.ENTITLEMENT_DENIED,
            details: { clientId, appName: entitlement.appName, reason: entitlement.reason },
            ipAddress: req.ip,
          }).catch(() => {})

          res.status(403).json({
            success: false,
            error: `Your plan does not include access to ${entitlement.appName ?? 'this application'}. Please upgrade your subscription.`,
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

        await finishInteractionAsJson(provider, req, res, result, {
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
        await finishInteractionAsJson(provider, req, res, result, {
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

        await finishInteractionAsJson(provider, req, res, result, {
          mergeWithLastSubmission: false,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/auth/interaction/:uid/google — Google OAuth during OIDC interaction
  router.post(
    '/api/auth/interaction/:uid/google',
    async (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()

      if (!isGoogleConfigured()) {
        res.status(501).json({ success: false, error: 'Google sign-in is not configured' })
        return
      }

      try {
        const { token, tokenType } = req.body as {
          token?: string
          tokenType?: 'id_token' | 'access_token'
        }

        if (!token) {
          res.status(400).json({ success: false, error: 'Google token is required' })
          return
        }

        const googleUser = await verifyGoogleToken(token, tokenType ?? 'id_token')

        // Find or create user from Google profile
        let user = await findUserByGoogleId(sql, googleUser.googleId)
        let isNewUser = false

        if (!user) {
          const existingByEmail = await findUserByEmail(sql, googleUser.email)
          if (existingByEmail) {
            // Link Google account to existing user
            const rows = await sql<
              {
                id: number
                username: string
                email: string
                display_name: string
                role: string
                parent_id: number | null
                google_id: string | null
                email_verified: boolean
                created_at: Date
                updated_at: Date
                deleted_at: Date | null
              }[]
            >`
              UPDATE users
              SET google_id = ${googleUser.googleId}, email_verified = true, updated_at = now()
              WHERE id = ${existingByEmail.id}
              RETURNING id, username, email, display_name, role, parent_id, google_id, email_verified, created_at, updated_at, deleted_at
            `
            user = rows[0] ?? null

            logger.info('linked google account during interaction', {
              operation: 'interactionGoogleLogin',
              userId: existingByEmail.id,
              duration: Date.now() - start,
            })
          } else {
            // Create new user from Google profile
            const username = await generateUniqueUsername(sql, googleUser.email)

            user = await createUser(sql, {
              username,
              email: googleUser.email,
              displayName: googleUser.name,
              googleId: googleUser.googleId,
              role: 'student',
            })
            isNewUser = true

            logger.info('created user via google during interaction', {
              operation: 'interactionGoogleLogin',
              userId: user.id,
              duration: Date.now() - start,
            })
          }
        }

        if (!user) {
          res.status(500).json({ success: false, error: 'Failed to authenticate with Google' })
          return
        }

        // Check entitlement
        const interactionDetails = await provider.interactionDetails(req, res)
        const clientId = String(
          (interactionDetails.params as Record<string, unknown>).client_id ?? '',
        )

        const entitlement = await checkUserEntitlement(sql, user.id, clientId)
        if (!entitlement.allowed) {
          logger.warn('google interaction login denied - no entitlement', {
            operation: 'interactionGoogleLogin',
            userId: user.id,
            clientId,
            reason: entitlement.reason,
            duration: Date.now() - start,
          })

          await logAction(sql, {
            actorId: user.id,
            action: AuditActions.ENTITLEMENT_DENIED,
            details: { clientId, appName: entitlement.appName, reason: entitlement.reason },
            ipAddress: req.ip,
          }).catch(() => {})

          res.status(403).json({
            success: false,
            error: `Your plan does not include access to ${entitlement.appName ?? 'this application'}. Please upgrade your subscription.`,
          })
          return
        }

        logger.info('google interaction login success', {
          operation: 'interactionGoogleLogin',
          userId: user.id,
          isNewUser,
          duration: Date.now() - start,
        })

        await logAction(sql, {
          actorId: user.id,
          action: isNewUser ? AuditActions.REGISTER : AuditActions.LOGIN,
          details: { source: 'google' },
          ipAddress: req.ip,
        }).catch(() => {})

        const result = {
          login: {
            accountId: String(user.id),
          },
        }

        await finishInteractionAsJson(provider, req, res, result, {
          mergeWithLastSubmission: false,
        })
      } catch (error) {
        logger.error('google interaction login failed', {
          operation: 'interactionGoogleLogin',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          uid: String(req.params.uid),
          hasCookies: Boolean(req.headers.cookie),
          duration: Date.now() - start,
        })
        next(error)
      }
    },
  )

  // NOTE: /api/auth/hub-logout is handled by hub-auth.ts (createHubAuthRouter),
  // which clears the __hub_session cookie AND redirects to the OIDC
  // end_session endpoint. Do NOT add a logout handler here —
  // this router is mounted before hub-auth, so a handler here would
  // shadow it and skip session destruction.

  return router
}
