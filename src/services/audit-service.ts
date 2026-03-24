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
  IMPERSONATE_START: 'impersonate_start',
  IMPERSONATE_END: 'impersonate_end',
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

  const conditions = buildFilterConditions(validated)

  if (conditions.length === 0) {
    return sql<AuditLog[]>`
      SELECT * FROM audit_log
      ORDER BY created_at DESC
      LIMIT ${validated.limit}
      OFFSET ${offset}
    `
  }

  const where = conditions.map((c) => c.clause).join(' AND ')

  return sql<AuditLog[]>`
    SELECT * FROM audit_log
    WHERE ${sql.unsafe(where)}
    ORDER BY created_at DESC
    LIMIT ${validated.limit}
    OFFSET ${offset}
  `
}

export async function countAuditLogs(sql: Sql, filters: unknown): Promise<number> {
  const validated = listAuditLogsSchema.parse(filters)

  const conditions = buildFilterConditions(validated)

  let rows: Array<{ count: string }>

  if (conditions.length === 0) {
    rows = await sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM audit_log
    `
  } else {
    const where = conditions.map((c) => c.clause).join(' AND ')
    rows = await sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM audit_log
      WHERE ${sql.unsafe(where)}
    `
  }

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

// --- Helpers ---

interface FilterCondition {
  clause: string
}

function buildFilterConditions(validated: ListAuditLogsInput): FilterCondition[] {
  const conditions: FilterCondition[] = []

  if (validated.actorId !== undefined) {
    conditions.push({ clause: `actor_id = ${validated.actorId}` })
  }
  if (validated.action !== undefined) {
    conditions.push({ clause: `action = '${validated.action}'` })
  }
  if (validated.targetId !== undefined) {
    conditions.push({ clause: `target_id = ${validated.targetId}` })
  }
  if (validated.startDate !== undefined) {
    conditions.push({
      clause: `created_at >= '${validated.startDate}'`,
    })
  }
  if (validated.endDate !== undefined) {
    conditions.push({
      clause: `created_at <= '${validated.endDate}'`,
    })
  }

  return conditions
}
