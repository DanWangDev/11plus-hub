import { OAuth2Client } from 'google-auth-library'
import { env } from '../config/env.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'google-auth' })

export interface GoogleUserInfo {
  googleId: string
  email: string
  name: string
  emailVerified: boolean
}

const client = new OAuth2Client()

export function isGoogleConfigured(): boolean {
  return !!env.GOOGLE_CLIENT_ID
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleUserInfo> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new Error('Google OAuth is not configured')
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  })

  const payload = ticket.getPayload()
  if (!payload?.sub || !payload.email) {
    throw new Error('Google account missing required fields')
  }

  logger.info('google id token verified', { googleId: payload.sub, email: payload.email })

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email.split('@')[0] ?? payload.email,
    emailVerified: payload.email_verified ?? false,
  }
}

/**
 * Verify a Google ID token. Only ID tokens (JWT credentials from Google
 * Identity Services) are accepted — never raw OAuth access tokens. Accepting
 * access tokens would let ANY leaked Google access token of a user
 * authenticate as them (access-token confusion), since access tokens are not
 * bound to this app's client.
 */
export async function verifyGoogleToken(token: string): Promise<GoogleUserInfo> {
  return verifyGoogleIdToken(token)
}
