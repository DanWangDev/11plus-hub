import bcrypt from 'bcrypt'
import { z } from 'zod'
import type postgres from 'postgres'

const BCRYPT_ROUNDS = 12
export const MIN_PASSWORD_LENGTH = 8

// --- Schemas ---

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
  displayName: z.string().min(1).max(100),
  role: z.enum(['student', 'parent', 'admin']).default('student'),
  parentId: z.number().int().positive().optional(),
  googleId: z.string().optional(),
})

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['student', 'parent', 'admin']).optional(),
  parentId: z.number().int().positive().nullable().optional(),
})

export const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  role: z.enum(['student', 'parent', 'admin']).optional(),
  search: z.string().optional(),
})

// --- Types ---

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type ListUsersInput = z.infer<typeof listUsersSchema>

export interface User {
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
  last_active_at: Date | null
}

export interface UserWithPassword extends User {
  password_hash: string | null
}

// --- Helpers ---

function excludePasswordHash(user: UserWithPassword): User {
  const { password_hash: _, ...rest } = user
  return rest
}

/**
 * Generate a unique username from a Google email prefix.
 * If the base username is taken, appends a random numeric suffix.
 */
export async function generateUniqueUsername(sql: postgres.Sql, email: string): Promise<string> {
  const emailPrefix = email.split('@')[0] ?? email
  const base = emailPrefix
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30)
    .padEnd(3, '_')

  const existing = await findUserByUsername(sql, base)
  if (!existing) {
    return base
  }

  // Append random digits until unique (max 5 attempts)
  for (let i = 0; i < 5; i++) {
    const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    const candidate = `${base.slice(0, 25)}_${suffix}`
    const taken = await findUserByUsername(sql, candidate)
    if (!taken) {
      return candidate
    }
  }

  // Fallback: timestamp-based suffix
  return `${base.slice(0, 20)}_${Date.now().toString(36)}`
}

// --- Service Functions ---

export async function createUser(sql: postgres.Sql, data: CreateUserInput): Promise<User> {
  const validated = createUserSchema.parse(data)

  const passwordHash = validated.password
    ? await bcrypt.hash(validated.password, BCRYPT_ROUNDS)
    : null

  const rows = await sql<UserWithPassword[]>`
    INSERT INTO users (username, email, password_hash, display_name, role, parent_id, google_id)
    VALUES (
      ${validated.username},
      ${validated.email},
      ${passwordHash},
      ${validated.displayName},
      ${validated.role},
      ${validated.parentId ?? null},
      ${validated.googleId ?? null}
    )
    RETURNING *
  `

  const user = rows[0]
  if (!user) {
    throw new Error('Failed to create user')
  }

  return excludePasswordHash(user)
}

export async function findUserById(sql: postgres.Sql, id: number): Promise<User | null> {
  const rows = await sql<User[]>`
    SELECT id, username, email, display_name, role, parent_id, google_id, email_verified, created_at, updated_at, deleted_at, last_active_at
    FROM users
    WHERE id = ${id} AND deleted_at IS NULL
  `

  return rows[0] ?? null
}

export async function softDeleteUser(sql: postgres.Sql, id: number): Promise<User | null> {
  const rows = await sql<UserWithPassword[]>`
    UPDATE users SET deleted_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING *
  `

  const user = rows[0]
  return user ? excludePasswordHash(user) : null
}

export async function findUserByEmail(
  sql: postgres.Sql,
  email: string,
): Promise<UserWithPassword | null> {
  const rows = await sql<UserWithPassword[]>`
    SELECT *
    FROM users
    WHERE email = ${email} AND deleted_at IS NULL
  `

  return rows[0] ?? null
}

export async function findUserByUsername(
  sql: postgres.Sql,
  username: string,
): Promise<UserWithPassword | null> {
  const rows = await sql<UserWithPassword[]>`
    SELECT *
    FROM users
    WHERE username = ${username} AND deleted_at IS NULL
  `

  return rows[0] ?? null
}

export async function findUserByGoogleId(
  sql: postgres.Sql,
  googleId: string,
): Promise<User | null> {
  const rows = await sql<User[]>`
    SELECT id, username, email, display_name, role, parent_id, google_id, email_verified, created_at, updated_at, deleted_at, last_active_at
    FROM users
    WHERE google_id = ${googleId} AND deleted_at IS NULL
  `

  return rows[0] ?? null
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash)
}

export async function updateUser(
  sql: postgres.Sql,
  id: number,
  data: UpdateUserInput,
): Promise<User | null> {
  const validated = updateUserSchema.parse(data)

  const setClauses: string[] = []
  const values: Record<string, unknown> = {}

  if (validated.displayName !== undefined) {
    setClauses.push('display_name')
    values.display_name = validated.displayName
  }
  if (validated.email !== undefined) {
    setClauses.push('email')
    values.email = validated.email
  }
  if (validated.role !== undefined) {
    setClauses.push('role')
    values.role = validated.role
  }
  if (validated.parentId !== undefined) {
    setClauses.push('parent_id')
    values.parent_id = validated.parentId
  }

  if (setClauses.length === 0) {
    return findUserById(sql, id)
  }

  const rows = await sql<UserWithPassword[]>`
    UPDATE users SET ${sql(values)}
    WHERE id = ${id}
    RETURNING *
  `

  const user = rows[0]
  if (!user) {
    return null
  }

  return excludePasswordHash(user)
}

export async function listUsers(sql: postgres.Sql, filters: ListUsersInput): Promise<User[]> {
  const validated = listUsersSchema.parse(filters)
  const offset = (validated.page - 1) * validated.limit

  if (validated.role && validated.search) {
    return sql<User[]>`
      SELECT id, username, email, display_name, role, parent_id, google_id, email_verified, created_at, updated_at, deleted_at, last_active_at
      FROM users
      WHERE deleted_at IS NULL AND role = ${validated.role}
        AND (username ILIKE ${'%' + validated.search + '%'} OR email ILIKE ${'%' + validated.search + '%'} OR display_name ILIKE ${'%' + validated.search + '%'})
      ORDER BY created_at DESC
      LIMIT ${validated.limit}
      OFFSET ${offset}
    `
  }

  if (validated.role) {
    return sql<User[]>`
      SELECT id, username, email, display_name, role, parent_id, google_id, email_verified, created_at, updated_at, deleted_at, last_active_at
      FROM users
      WHERE deleted_at IS NULL AND role = ${validated.role}
      ORDER BY created_at DESC
      LIMIT ${validated.limit}
      OFFSET ${offset}
    `
  }

  if (validated.search) {
    return sql<User[]>`
      SELECT id, username, email, display_name, role, parent_id, google_id, email_verified, created_at, updated_at, deleted_at, last_active_at
      FROM users
      WHERE deleted_at IS NULL AND (username ILIKE ${'%' + validated.search + '%'} OR email ILIKE ${'%' + validated.search + '%'} OR display_name ILIKE ${'%' + validated.search + '%'})
      ORDER BY created_at DESC
      LIMIT ${validated.limit}
      OFFSET ${offset}
    `
  }

  return sql<User[]>`
    SELECT id, username, email, display_name, role, parent_id, google_id, email_verified, created_at, updated_at, deleted_at, last_active_at
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ${validated.limit}
    OFFSET ${offset}
  `
}

export async function countUsers(sql: postgres.Sql, filters: ListUsersInput): Promise<number> {
  const validated = listUsersSchema.parse(filters)

  let rows: { count: string }[]

  if (validated.role && validated.search) {
    rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM users
      WHERE deleted_at IS NULL AND role = ${validated.role}
        AND (username ILIKE ${'%' + validated.search + '%'} OR email ILIKE ${'%' + validated.search + '%'} OR display_name ILIKE ${'%' + validated.search + '%'})
    `
  } else if (validated.role) {
    rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM users
      WHERE deleted_at IS NULL AND role = ${validated.role}
    `
  } else if (validated.search) {
    rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM users
      WHERE deleted_at IS NULL AND (username ILIKE ${'%' + validated.search + '%'} OR email ILIKE ${'%' + validated.search + '%'} OR display_name ILIKE ${'%' + validated.search + '%'})
    `
  } else {
    rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM users
      WHERE deleted_at IS NULL
    `
  }

  return Number(rows[0]?.count ?? 0)
}

export async function hasPassword(sql: postgres.Sql, userId: number): Promise<boolean> {
  const rows = await sql<{ has: boolean }[]>`
    SELECT (password_hash IS NOT NULL) AS has
    FROM users
    WHERE id = ${userId} AND deleted_at IS NULL
  `
  return rows[0]?.has ?? false
}

export async function updatePassword(
  sql: postgres.Sql,
  userId: number,
  newPasswordHash: string,
): Promise<void> {
  await sql`
    UPDATE users SET password_hash = ${newPasswordHash}
    WHERE id = ${userId} AND deleted_at IS NULL
  `
}

// Throttle last_active_at updates to at most once per 5 minutes per user.
// The throttle lives in the WHERE clause so callers (auth middleware, OIDC
// grant.success, login routes) can fire-and-forget without coordinating.
export const LAST_ACTIVE_THROTTLE_MINUTES = 5

export async function updateLastActive(sql: postgres.Sql, userId: number): Promise<void> {
  await sql`
    UPDATE users SET last_active_at = now()
    WHERE id = ${userId}
      AND deleted_at IS NULL
      AND (last_active_at IS NULL OR last_active_at < now() - interval '5 minutes')
  `
}

export async function findUserWithPasswordHash(
  sql: postgres.Sql,
  userId: number,
): Promise<UserWithPassword | null> {
  const rows = await sql<UserWithPassword[]>`
    SELECT *
    FROM users
    WHERE id = ${userId} AND deleted_at IS NULL
  `
  return rows[0] ?? null
}
