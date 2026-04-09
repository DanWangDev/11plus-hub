import { env } from '../config/env.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'turnstile' })

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

interface TurnstileVerifyResponse {
  success: boolean
  'error-codes'?: string[]
}

export function isTurnstileConfigured(): boolean {
  return !!env.TURNSTILE_SECRET_KEY
}

export async function verifyTurnstileToken(token: string, remoteIp: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) {
    return true
  }

  if (!token) {
    logger.warn('turnstile token missing', { remoteIp })
    return false
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: remoteIp,
      }),
    })

    const result = (await response.json()) as TurnstileVerifyResponse

    if (!result.success) {
      logger.warn('turnstile verification failed', {
        errorCodes: result['error-codes'],
        remoteIp,
      })
    }

    return result.success
  } catch (error) {
    logger.error('turnstile verification error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      remoteIp,
    })
    return false
  }
}
