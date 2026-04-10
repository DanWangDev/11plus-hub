import { createHash } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-secret-auth' })

/**
 * Middleware that intercepts POST /oidc/token requests using client_secret_post
 * and replaces the plaintext client_secret with its SHA-256 hash.
 *
 * This implements the IdentityServer pattern:
 * - DB stores SHA-256(secret) in client_secret_sha256
 * - client-loader.ts passes that hash as oidc-provider's client_secret
 * - This middleware hashes the incoming plaintext so oidc-provider's
 *   string comparison matches: SHA-256(incoming) === SHA-256(stored)
 *
 * The client app sends the raw plaintext secret (standard OAuth2 behavior).
 * The hashing is transparent to both the client and oidc-provider.
 */
export function createSecretAuthMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Only intercept token endpoint POST requests with client_secret in body
    if (req.method !== 'POST' || !req.body?.client_secret) {
      next()
      return
    }

    const plaintextSecret = String(req.body.client_secret)

    // Replace the plaintext with its SHA-256 hash before oidc-provider processes it
    req.body = {
      ...req.body,
      client_secret: createHash('sha256').update(plaintextSecret).digest('hex'),
    }

    logger.info('client secret hashed for oidc verification', {
      operation: 'secretAuthMiddleware',
      clientId: req.body.client_id ?? 'unknown',
    })

    next()
  }
}
