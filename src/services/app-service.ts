import { randomUUID, randomBytes, createHash } from 'crypto'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import type postgres from 'postgres'
import { AppError } from '../middleware/error-handler.js'

// ---------- Zod schemas ----------

export const createAppSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  url: z.string().url(),
  redirectUris: z.array(z.string().url()).min(1),
  iconUrl: z.string().url().optional(),
  statsApiUrl: z.string().url().optional(),
})

export const updateAppSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  redirectUris: z.array(z.string().url()).min(1).optional(),
  iconUrl: z.string().url().nullable().optional(),
  statsApiUrl: z.string().url().nullable().optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
})

export const listAppsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
})

// ---------- Types ----------

export type CreateAppInput = z.infer<typeof createAppSchema>
export type UpdateAppInput = z.infer<typeof updateAppSchema>
export type ListAppsInput = z.infer<typeof listAppsSchema>

export interface Application {
  id: number
  name: string
  slug: string
  url: string
  client_id: string
  client_secret_hash: string
  redirect_uris: string[]
  icon_url: string | null
  stats_api_url: string | null
  status: string
  created_at: Date
}

export interface ServiceToken {
  id: number
  app_id: number
  token_hash: string
  scopes: string[]
  expires_at: Date | null
  created_at: Date
}

type Sql = postgres.Sql

const BCRYPT_ROUNDS = 12

// ---------- Helpers ----------

function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// ---------- Service functions ----------

export async function createApplication(
  sql: Sql,
  data: unknown,
): Promise<{ application: Application; clientSecret: string }> {
  const validated = createAppSchema.parse(data)

  const clientId = randomUUID()
  const clientSecret = randomBytes(32).toString('hex')
  const clientSecretHash = await bcrypt.hash(clientSecret, BCRYPT_ROUNDS)

  const rows = await sql`
    INSERT INTO applications (name, slug, url, client_id, client_secret_hash, redirect_uris, icon_url, stats_api_url)
    VALUES (
      ${validated.name},
      ${validated.slug},
      ${validated.url},
      ${clientId},
      ${clientSecretHash},
      ${validated.redirectUris},
      ${validated.iconUrl ?? null},
      ${validated.statsApiUrl ?? null}
    )
    RETURNING *
  `

  const application = rows[0] as Application

  if (!application) {
    throw new AppError(500, 'Failed to create application')
  }

  return { application, clientSecret }
}

export async function findApplicationById(sql: Sql, id: number): Promise<Application | null> {
  const rows = await sql`
    SELECT * FROM applications WHERE id = ${id}
  `
  return (rows[0] as Application) ?? null
}

export async function findApplicationByClientId(
  sql: Sql,
  clientId: string,
): Promise<Application | null> {
  const rows = await sql`
    SELECT * FROM applications WHERE client_id = ${clientId}
  `
  return (rows[0] as Application) ?? null
}

export async function findApplicationBySlug(sql: Sql, slug: string): Promise<Application | null> {
  const rows = await sql`
    SELECT * FROM applications WHERE slug = ${slug}
  `
  return (rows[0] as Application) ?? null
}

export async function verifyClientSecret(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash)
}

export async function updateApplication(
  sql: Sql,
  id: number,
  data: unknown,
): Promise<Application | null> {
  const validated = updateAppSchema.parse(data)

  const existing = await findApplicationById(sql, id)
  if (!existing) {
    return null
  }

  const updated = {
    name: validated.name ?? existing.name,
    url: validated.url ?? existing.url,
    redirect_uris:
      validated.redirectUris !== undefined ? validated.redirectUris : existing.redirect_uris,
    icon_url: validated.iconUrl !== undefined ? validated.iconUrl : existing.icon_url,
    stats_api_url:
      validated.statsApiUrl !== undefined ? validated.statsApiUrl : existing.stats_api_url,
    status: validated.status ?? existing.status,
  }

  const rows = await sql`
    UPDATE applications
    SET
      name = ${updated.name},
      url = ${updated.url},
      redirect_uris = ${updated.redirect_uris},
      icon_url = ${updated.icon_url},
      stats_api_url = ${updated.stats_api_url},
      status = ${updated.status}
    WHERE id = ${id}
    RETURNING *
  `

  return (rows[0] as Application) ?? null
}

export async function listApplications(
  sql: Sql,
  filters: unknown,
): Promise<{ applications: Application[]; total: number }> {
  const validated = listAppsSchema.parse(filters)
  const offset = (validated.page - 1) * validated.limit

  let applications: Application[]
  let countRows: Array<{ count: number }>

  if (validated.status) {
    applications = (await sql`
      SELECT * FROM applications
      WHERE status = ${validated.status}
      ORDER BY created_at DESC
      LIMIT ${validated.limit}
      OFFSET ${offset}
    `) as Application[]

    countRows = (await sql`
      SELECT COUNT(*)::int AS count FROM applications WHERE status = ${validated.status}
    `) as Array<{ count: number }>
  } else {
    applications = (await sql`
      SELECT * FROM applications
      ORDER BY created_at DESC
      LIMIT ${validated.limit}
      OFFSET ${offset}
    `) as Application[]

    countRows = (await sql`
      SELECT COUNT(*)::int AS count FROM applications
    `) as Array<{ count: number }>
  }

  const total = countRows[0]?.count ?? 0

  return { applications, total }
}

export async function rotateClientSecret(
  sql: Sql,
  id: number,
): Promise<{ application: Application; clientSecret: string } | null> {
  const existing = await findApplicationById(sql, id)
  if (!existing) {
    return null
  }

  const clientSecret = randomBytes(32).toString('hex')
  const clientSecretHash = await bcrypt.hash(clientSecret, BCRYPT_ROUNDS)

  const rows = await sql`
    UPDATE applications
    SET client_secret_hash = ${clientSecretHash}
    WHERE id = ${id}
    RETURNING *
  `

  const application = rows[0] as Application

  if (!application) {
    return null
  }

  return { application, clientSecret }
}

export async function createServiceToken(
  sql: Sql,
  appId: number,
  scopes: string[] = [],
): Promise<{ serviceToken: ServiceToken; token: string }> {
  const app = await findApplicationById(sql, appId)
  if (!app) {
    throw new AppError(404, 'Application not found')
  }

  const token = randomBytes(48).toString('hex')
  const tokenHash = hashSha256(token)

  const rows = await sql`
    INSERT INTO service_tokens (app_id, token_hash, scopes)
    VALUES (${appId}, ${tokenHash}, ${scopes})
    RETURNING *
  `

  const serviceToken = rows[0] as ServiceToken

  if (!serviceToken) {
    throw new AppError(500, 'Failed to create service token')
  }

  return { serviceToken, token }
}

export async function verifyServiceToken(
  sql: Sql,
  tokenPlaintext: string,
): Promise<ServiceToken | null> {
  const tokenHash = hashSha256(tokenPlaintext)

  const rows = await sql`
    SELECT * FROM service_tokens WHERE token_hash = ${tokenHash}
  `

  const serviceToken = (rows[0] as ServiceToken) ?? null

  if (!serviceToken) {
    return null
  }

  if (serviceToken.expires_at && new Date(serviceToken.expires_at) < new Date()) {
    return null
  }

  return serviceToken
}

export async function revokeServiceToken(sql: Sql, tokenId: number): Promise<boolean> {
  const rows = await sql`
    DELETE FROM service_tokens WHERE id = ${tokenId} RETURNING id
  `
  return rows.length > 0
}
