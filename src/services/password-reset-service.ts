import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import type postgres from 'postgres'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'password-reset-service' })

const BCRYPT_ROUNDS = 12
const TOKEN_EXPIRY_HOURS = 1

// --- Schemas ---

export const requestResetSchema = z.object({
  email: z.string().email(),
})

export const resetPasswordSchema = z.object({
  selector: z.string().min(1),
  validator: z.string().min(1),
  newPassword: z.string().min(8),
})

// --- Types ---

export type RequestResetInput = z.infer<typeof requestResetSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export interface ResetToken {
  selector: string
  validator: string
}

export interface PasswordResetRecord {
  id: number
  user_id: number
  selector: string
  validator_hash: string
  expires_at: Date
  created_at: Date
}

type Sql = postgres.Sql

// --- Service Functions ---

export async function createResetToken(sql: Sql, userId: number): Promise<ResetToken> {
  const selector = crypto.randomBytes(16).toString('hex')
  const validator = crypto.randomBytes(32).toString('hex')
  const validatorHash = crypto.createHash('sha256').update(validator).digest('hex')

  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)

  // Delete any existing tokens for this user
  await sql`
    DELETE FROM password_reset_tokens WHERE user_id = ${userId}
  `

  await sql`
    INSERT INTO password_reset_tokens (user_id, selector, validator_hash, expires_at)
    VALUES (${userId}, ${selector}, ${validatorHash}, ${expiresAt})
  `

  logger.info('password reset token created', {
    operation: 'createResetToken',
    userId,
    expiresAt: expiresAt.toISOString(),
  })

  return { selector, validator }
}

export async function validateResetToken(
  sql: Sql,
  selector: string,
  validator: string,
): Promise<{ userId: number } | null> {
  const rows = await sql<PasswordResetRecord[]>`
    SELECT * FROM password_reset_tokens
    WHERE selector = ${selector}
      AND expires_at > now()
  `

  const record = rows[0]
  if (!record) {
    logger.warn('password reset token not found or expired', {
      operation: 'validateResetToken',
      selector,
    })
    return null
  }

  const validatorHash = crypto.createHash('sha256').update(validator).digest('hex')

  if (validatorHash !== record.validator_hash) {
    logger.warn('password reset token validator mismatch', {
      operation: 'validateResetToken',
      selector,
    })
    return null
  }

  return { userId: record.user_id }
}

export async function resetPassword(sql: Sql, data: ResetPasswordInput): Promise<boolean> {
  const validated = resetPasswordSchema.parse(data)

  const tokenResult = await validateResetToken(sql, validated.selector, validated.validator)
  if (!tokenResult) {
    return false
  }

  const passwordHash = await bcrypt.hash(validated.newPassword, BCRYPT_ROUNDS)

  await sql`
    UPDATE users SET password_hash = ${passwordHash} WHERE id = ${tokenResult.userId}
  `

  // Delete the used token
  await sql`
    DELETE FROM password_reset_tokens WHERE selector = ${validated.selector}
  `

  logger.info('password reset completed', {
    operation: 'resetPassword',
    userId: tokenResult.userId,
  })

  return true
}

export async function deleteExpiredTokens(sql: Sql): Promise<number> {
  const result = await sql`
    DELETE FROM password_reset_tokens WHERE expires_at <= now()
  `

  const count = result.count
  if (count > 0) {
    logger.info('expired password reset tokens cleaned up', {
      operation: 'deleteExpiredTokens',
      count,
    })
  }

  return count
}
