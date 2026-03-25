import { z } from 'zod'
import type postgres from 'postgres'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'audit-service' })

// --- Action Constants ---

export const AuditActions = {
  LOGIN: 'login',
  LOGIN_FAILED: 'login_failed',
  REGISTER: 'register',
  LOGOUT: 'logout',
  PASSWORD_RESET_REQUEST: 'password_reset_request',
  PASSWORD_RESET_COMPLETE: 'password_reset_complete',
  USER_UPDATE: 'user_update',
  USER_DELETE: 'user_delete',
  SUBSCRIPTION_CREATE: 'subscription_create',
  SUBSCRIPTION_UPDATE: 'subscription_update',
  SUBSCRIPTION_CANCEL: 'subscription_cancel',
  APP_ACCESS_GRANT: 'app_access_grant',
  APP_ACCESS_REVOKE: 'app_access_revoke',
  APP_REGISTER: 'app_register',
  APP_UPDATE: 'app_update',
  APP_DELETE: 'app_delete',
  IMPERSONATE_START: 'impersonate_start',
  IMPERSONATE_END: 'impersonate_end',
  ENTITLEMENT_DENIED: 'entitlement_denied',
} as const

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions]

// --- Schemas ---

export const logActionSchema = z.object({
  actorId: z.number().int().positive().nullable().optional(),
  action: z.string().min(1).max(100),
  targetId: z.number().int().positive().optional(),
  details: z.record(z.unknown()).default({}),
  ipAddress: z.string().optional(),
})

export const listAuditLogsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  actorId: z.coerce.number().int().positive().optional(),
  action: z.string().optional(),
  targetId: z.coerce.number().int().positive().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
})

// --- Types ---

export type LogActionInput = z.infer<typeof logActionSchema>
export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>

export interface AuditLog {
  id: number
  actor_id: number | null
  action: string
  target_id: number | null
  details: Record<string, unknown>
  ip_address: string | null
  created_at: Date
  actor_username?: string | null
}

type Sql = postgres.Sql

// --- Service Functions ---

export async function logAction(sql: Sql, data: unknown): Promise<AuditLog> {
  const validated = logActionSchema.parse(data)

  const rows = await sql<AuditLog[]>`
    INSERT INTO audit_log (actor_id, action, target_id, details, ip_address)
    VALUES (
      ${validated.actorId ?? null},
      ${validated.action},
      ${validated.targetId ?? null},
      ${JSON.stringify(validated.details)},
      ${validated.ipAddress ?? null}
    )
    RETURNING *
  `

  const entry = rows[0]
  if (!entry) {
    throw new Error('Failed to create audit log entry')
  }

  logger.info('audit action logged', {
    operation: 'logAction',
    action: validated.action,
    actorId: validated.actorId ?? null,
    targetId: validated.targetId ?? null,
  })

  return entry
}

export async function getAuditLogs(sql: Sql, filters: unknown): Promise<AuditLog[]> {
  const validated = listAuditLogsSchema.parse(filters)
  const offset = (validated.page - 1) * validated.limit

  const hasAction = validated.action !== undefined
  const hasActor = validated.actorId !== undefined
  const hasTarget = validated.targetId !== undefined
  const hasStart = validated.startDate !== undefined
  const hasEnd = validated.endDate !== undefined

  return sql<AuditLog[]>`
    SELECT a.*, u.username AS actor_username
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE 1=1
      ${hasAction ? sql`AND a.action = ${validated.action!}` : sql``}
      ${hasActor ? sql`AND a.actor_id = ${validated.actorId!}` : sql``}
      ${hasTarget ? sql`AND a.target_id = ${validated.targetId!}` : sql``}
      ${hasStart ? sql`AND a.created_at >= ${validated.startDate!}` : sql``}
      ${hasEnd ? sql`AND a.created_at <= ${validated.endDate!}` : sql``}
    ORDER BY a.created_at DESC
    LIMIT ${validated.limit}
    OFFSET ${offset}
  `
}

export async function countAuditLogs(sql: Sql, filters: unknown): Promise<number> {
  const validated = listAuditLogsSchema.parse(filters)

  const hasAction = validated.action !== undefined
  const hasActor = validated.actorId !== undefined
  const hasTarget = validated.targetId !== undefined
  const hasStart = validated.startDate !== undefined
  const hasEnd = validated.endDate !== undefined

  const rows = await sql<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count FROM audit_log a
    WHERE 1=1
      ${hasAction ? sql`AND a.action = ${validated.action!}` : sql``}
      ${hasActor ? sql`AND a.actor_id = ${validated.actorId!}` : sql``}
      ${hasTarget ? sql`AND a.target_id = ${validated.targetId!}` : sql``}
      ${hasStart ? sql`AND a.created_at >= ${validated.startDate!}` : sql``}
      ${hasEnd ? sql`AND a.created_at <= ${validated.endDate!}` : sql``}
  `

  return Number(rows[0]?.count ?? 0)
}

export async function getAuditLogById(sql: Sql, id: number): Promise<AuditLog | null> {
  const rows = await sql<AuditLog[]>`
    SELECT * FROM audit_log WHERE id = ${id}
  `

  return rows[0] ?? null
}

export async function getActorHistory(
  sql: Sql,
  actorId: number,
  filters: Record<string, unknown> = {},
): Promise<AuditLog[]> {
  const validated = listAuditLogsSchema.parse({ ...filters, actorId })
  const offset = (validated.page - 1) * validated.limit

  return sql<AuditLog[]>`
    SELECT * FROM audit_log
    WHERE actor_id = ${actorId}
    ORDER BY created_at DESC
    LIMIT ${validated.limit}
    OFFSET ${offset}
  `
}
