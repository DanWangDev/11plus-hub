import { env } from '../config/env.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'email-service' })

const RESEND_API_URL = 'https://api.resend.com/emails'

export function isEmailConfigured(): boolean {
  return !!env.RESEND_API_KEY
}

/**
 * Send a password reset email via Resend. Returns false (never throws) when
 * email is not configured or the send fails — callers keep their generic
 * responses so account enumeration stays impossible.
 */
export async function sendPasswordResetEmail(
  to: string,
  selector: string,
  validator: string,
  resetPageUrl: string,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    logger.warn('password reset email skipped: RESEND_API_KEY not configured', {
      operation: 'sendPasswordResetEmail',
    })
    return false
  }

  const link = `${resetPageUrl}?selector=${encodeURIComponent(selector)}&validator=${encodeURIComponent(validator)}`

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject: 'Reset your 11+ Hub password',
        html: `<p>We received a request to reset your 11+ Hub password.</p>
<p><a href="${link}">Reset your password</a></p>
<p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
      }),
    })

    if (!response.ok) {
      logger.error('password reset email rejected by Resend', {
        operation: 'sendPasswordResetEmail',
        status: response.status,
        body: await response.text(),
      })
      return false
    }

    logger.info('password reset email sent', {
      operation: 'sendPasswordResetEmail',
      to,
    })
    return true
  } catch (error) {
    logger.error('password reset email send failed', {
      operation: 'sendPasswordResetEmail',
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
