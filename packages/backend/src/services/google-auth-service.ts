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

export async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error('Invalid Google access token')
  }

  const payload = (await response.json()) as {
    sub?: string
    email?: string
    name?: string
    email_verified?: boolean
  }

  if (!payload.sub || !payload.email) {
    throw new Error('Google account missing required fields')
  }

  logger.info('google access token verified', { googleId: payload.sub, email: payload.email })

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email.split('@')[0] ?? payload.email,
    emailVerified: payload.email_verified ?? false,
  }
}

export async function verifyGoogleToken(
  token: string,
  tokenType: 'id_token' | 'access_token' = 'id_token',
): Promise<GoogleUserInfo> {
  if (tokenType === 'access_token') {
    return verifyGoogleAccessToken(token)
  }
  return verifyGoogleIdToken(token)
}
