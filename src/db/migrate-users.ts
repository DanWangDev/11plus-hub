import Database from 'better-sqlite3'
import { createDb, closeDb } from './connection.js'
import { createLogger } from '../lib/logger.js'
import type postgres from 'postgres'

const logger = createLogger({ service: 'user-migration' })

// --- Source schemas ---

interface VocabMasterUser {
  id: number
  username: string
  password_hash: string | null
  display_name: string | null
  role: string
  parent_id: number | null
  email: string | null
  email_verified: number | null
  google_id: string | null
  auth_provider: string | null
  last_seen_at: string | null
  created_at: string | null
}

interface WritingBuddyUser {
  id: string
  email: string
  display_name: string
  password_hash: string
  role: string
  parent_id: string | null
  subscription_plan: string | null
  subscription_status: string | null
  created_at: string | null
  updated_at: string | null
}

// --- Target types ---

interface HubUser {
  username: string
  email: string
  password_hash: string | null
  display_name: string
  role: string
  google_id: string | null
  email_verified: boolean
  created_at: string | null
}

interface MigrationResult {
  source: string
  sourceId: string
  hubId: number
  username: string
  email: string
}

// --- Role mapping ---

function mapRole(role: string, source: string): string {
  const roleMap: Record<string, string> = {
    student: 'student',
    parent: 'parent',
    admin: 'admin',
    tutor: 'parent', // writing-buddy tutors → parent role in hub
  }
  const mapped = roleMap[role]
  if (!mapped) {
    logger.warn('unknown role, defaulting to student', { role, source })
    return 'student'
  }
  return mapped
}

// --- Username generation ---

function generateUsername(email: string, existingUsernames: Set<string>): string {
  const base = email.split('@')[0]?.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'user'
  const trimmed = base.slice(0, 27) // leave room for suffix
  if (trimmed.length >= 3 && !existingUsernames.has(trimmed)) {
    existingUsernames.add(trimmed)
    return trimmed
  }
  let counter = 1
  let candidate = `${trimmed}_${counter}`
  while (existingUsernames.has(candidate)) {
    counter++
    candidate = `${trimmed}_${counter}`
  }
  existingUsernames.add(candidate)
  return candidate
}

// --- Read vocab-master users ---

function readVocabMasterUsers(dbPath: string): VocabMasterUser[] {
  logger.info('reading vocab-master database', { dbPath })
  const db = new Database(dbPath, { readonly: true })
  try {
    const users = db.prepare('SELECT * FROM users').all() as VocabMasterUser[]
    logger.info('vocab-master users loaded', { count: users.length })
    return users
  } finally {
    db.close()
  }
}

// --- Read writing-buddy users ---

function readWritingBuddyUsers(dbPath: string): WritingBuddyUser[] {
  logger.info('reading writing-buddy database', { dbPath })
  const db = new Database(dbPath, { readonly: true })
  try {
    const users = db.prepare('SELECT * FROM users').all() as WritingBuddyUser[]
    logger.info('writing-buddy users loaded', { count: users.length })
    return users
  } finally {
    db.close()
  }
}

// --- Insert user into hub ---

async function insertHubUser(
  sql: postgres.Sql,
  user: HubUser,
): Promise<{ id: number } | undefined> {
  const rows = await sql`
    INSERT INTO users (username, email, password_hash, display_name, role, google_id, email_verified, created_at)
    VALUES (
      ${user.username},
      ${user.email},
      ${user.password_hash},
      ${user.display_name},
      ${user.role},
      ${user.google_id},
      ${user.email_verified},
      ${user.created_at ?? new Date().toISOString()}
    )
    ON CONFLICT (email) DO UPDATE SET
      password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
      google_id = COALESCE(users.google_id, EXCLUDED.google_id),
      display_name = COALESCE(NULLIF(users.display_name, ''), EXCLUDED.display_name)
    RETURNING id
  `
  return rows[0] as { id: number } | undefined
}

// --- Create subscription ---

async function createSubscription(
  sql: postgres.Sql,
  userId: number,
  plan: string,
  status: string,
): Promise<void> {
  const planMap: Record<string, string> = {
    free: 'free',
    writing: 'writing',
    vocab: 'vocab',
    bundle: 'bundle',
    family: 'family',
    premium: 'bundle',
  }
  const featureMap: Record<string, string[]> = {
    free: [],
    writing: ['writing'],
    vocab: ['vocab'],
    bundle: ['writing', 'vocab'],
    family: ['writing', 'vocab'],
  }
  const statusMap: Record<string, string> = {
    active: 'active',
    trial: 'trial',
    expired: 'expired',
    cancelled: 'cancelled',
    canceled: 'cancelled',
  }

  const mappedPlan = planMap[plan] ?? 'free'
  const features = featureMap[mappedPlan] ?? []
  const mappedStatus = statusMap[status] ?? 'active'

  await sql`
    INSERT INTO subscriptions (user_id, plan, status, features)
    VALUES (${userId}, ${mappedPlan}, ${mappedStatus}, ${features})
    ON CONFLICT DO NOTHING
  `
}

// --- Grant app access ---

async function grantAppAccess(sql: postgres.Sql, userId: number, appSlug: string): Promise<void> {
  const apps = await sql`SELECT id FROM applications WHERE slug = ${appSlug}`
  const app = apps[0] as { id: number } | undefined
  if (!app) {
    logger.warn('app not found for access grant', { appSlug })
    return
  }
  await sql`
    INSERT INTO user_app_access (user_id, app_id)
    VALUES (${userId}, ${app.id})
    ON CONFLICT DO NOTHING
  `
}

// --- Main migration ---

interface MigrationOptions {
  vocabMasterDbPath?: string
  writingBuddyDbPath?: string
  dryRun?: boolean
}

async function migrateUsers(options: MigrationOptions): Promise<void> {
  const sql = createDb()
  const results: MigrationResult[] = []
  const existingUsernames = new Set<string>()
  const emailToHubId = new Map<string, number>()

  try {
    // Load existing usernames from hub
    const existing = await sql`SELECT username FROM users`
    for (const row of existing) {
      existingUsernames.add((row as { username: string }).username)
    }
    logger.info('existing hub users loaded', { count: existingUsernames.size })

    // --- Migrate vocab-master users ---
    if (options.vocabMasterDbPath) {
      const vmUsers = readVocabMasterUsers(options.vocabMasterDbPath)
      // Track parent mappings: old VM id → new hub id
      const vmParentMap = new Map<number, number>()

      // First pass: non-child users (no parent_id)
      const parents = vmUsers.filter((u) => !u.parent_id)
      const children = vmUsers.filter((u) => u.parent_id)

      for (const user of parents) {
        const email = user.email ?? `${user.username}@migrated.local`
        const hubUser: HubUser = {
          username: user.username,
          email,
          password_hash: user.password_hash,
          display_name: user.display_name ?? user.username,
          role: mapRole(user.role, 'vocab-master'),
          google_id: user.google_id ?? null,
          email_verified: Boolean(user.email_verified),
          created_at: user.created_at,
        }

        if (options.dryRun) {
          logger.info('dry run: would insert vocab-master user', {
            username: hubUser.username,
            email: hubUser.email,
            role: hubUser.role,
          })
          continue
        }

        const result = await insertHubUser(sql, hubUser)
        if (result) {
          vmParentMap.set(user.id, result.id)
          emailToHubId.set(email, result.id)
          results.push({
            source: 'vocab-master',
            sourceId: String(user.id),
            hubId: result.id,
            username: hubUser.username,
            email,
          })

          // Grant vocab-master app access
          await grantAppAccess(sql, result.id, 'vocab-master')

          logger.info('migrated vocab-master user', {
            operation: 'migrateUser',
            sourceId: user.id,
            hubId: result.id,
            username: hubUser.username,
          })
        }
      }

      // Second pass: child users (with parent_id)
      for (const user of children) {
        const email = user.email ?? `${user.username}@migrated.local`
        const hubParentId = user.parent_id ? vmParentMap.get(user.parent_id) : undefined
        const hubUser: HubUser = {
          username: user.username,
          email,
          password_hash: user.password_hash,
          display_name: user.display_name ?? user.username,
          role: mapRole(user.role, 'vocab-master'),
          google_id: user.google_id ?? null,
          email_verified: Boolean(user.email_verified),
          created_at: user.created_at,
        }

        if (options.dryRun) {
          logger.info('dry run: would insert vocab-master child user', {
            username: hubUser.username,
            email: hubUser.email,
            parentId: hubParentId,
          })
          continue
        }

        const result = await insertHubUser(sql, hubUser)
        if (result) {
          vmParentMap.set(user.id, result.id)
          emailToHubId.set(email, result.id)

          // Set parent_id if parent was migrated
          if (hubParentId) {
            await sql`UPDATE users SET parent_id = ${hubParentId} WHERE id = ${result.id}`
          }

          await grantAppAccess(sql, result.id, 'vocab-master')

          results.push({
            source: 'vocab-master',
            sourceId: String(user.id),
            hubId: result.id,
            username: hubUser.username,
            email,
          })

          logger.info('migrated vocab-master child user', {
            operation: 'migrateUser',
            sourceId: user.id,
            hubId: result.id,
            parentId: hubParentId,
          })
        }
      }

      logger.info('vocab-master migration complete', {
        total: vmUsers.length,
        migrated: results.filter((r) => r.source === 'vocab-master').length,
      })
    }

    // --- Migrate writing-buddy users ---
    if (options.writingBuddyDbPath) {
      const wbUsers = readWritingBuddyUsers(options.writingBuddyDbPath)
      const wbParentMap = new Map<string, number>()

      const parents = wbUsers.filter((u) => !u.parent_id)
      const children = wbUsers.filter((u) => u.parent_id)

      for (const user of parents) {
        const username = generateUsername(user.email, existingUsernames)
        const hubUser: HubUser = {
          username,
          email: user.email,
          password_hash: user.password_hash,
          display_name: user.display_name,
          role: mapRole(user.role, 'writing-buddy'),
          google_id: null,
          email_verified: false,
          created_at: user.created_at,
        }

        if (options.dryRun) {
          logger.info('dry run: would insert writing-buddy user', {
            username: hubUser.username,
            email: hubUser.email,
            role: hubUser.role,
            subscription: user.subscription_plan,
          })
          continue
        }

        // Check if email already exists from vocab-master migration
        const existingHubId = emailToHubId.get(user.email)
        let hubId: number

        if (existingHubId) {
          hubId = existingHubId
          logger.info('writing-buddy user already migrated via email match', {
            email: user.email,
            hubId,
          })
        } else {
          const result = await insertHubUser(sql, hubUser)
          if (!result) continue
          hubId = result.id
          emailToHubId.set(user.email, hubId)
        }

        wbParentMap.set(user.id, hubId)

        // Grant writing-buddy app access
        await grantAppAccess(sql, hubId, 'writing-buddy')

        // Migrate subscription if present
        if (user.subscription_plan && user.subscription_plan !== 'free') {
          await createSubscription(
            sql,
            hubId,
            user.subscription_plan,
            user.subscription_status ?? 'active',
          )
        }

        results.push({
          source: 'writing-buddy',
          sourceId: user.id,
          hubId,
          username: hubUser.username,
          email: user.email,
        })

        logger.info('migrated writing-buddy user', {
          operation: 'migrateUser',
          sourceId: user.id,
          hubId,
          username: hubUser.username,
        })
      }

      // Second pass: children
      for (const user of children) {
        const username = generateUsername(user.email, existingUsernames)
        const hubParentId = user.parent_id ? wbParentMap.get(user.parent_id) : undefined
        const hubUser: HubUser = {
          username,
          email: user.email,
          password_hash: user.password_hash,
          display_name: user.display_name,
          role: mapRole(user.role, 'writing-buddy'),
          google_id: null,
          email_verified: false,
          created_at: user.created_at,
        }

        if (options.dryRun) {
          logger.info('dry run: would insert writing-buddy child user', {
            username: hubUser.username,
            email: hubUser.email,
            parentId: hubParentId,
          })
          continue
        }

        const existingHubId = emailToHubId.get(user.email)
        let hubId: number

        if (existingHubId) {
          hubId = existingHubId
        } else {
          const result = await insertHubUser(sql, hubUser)
          if (!result) continue
          hubId = result.id
          emailToHubId.set(user.email, hubId)
        }

        wbParentMap.set(user.id, hubId)

        if (hubParentId) {
          await sql`UPDATE users SET parent_id = ${hubParentId} WHERE id = ${hubId}`
        }

        await grantAppAccess(sql, hubId, 'writing-buddy')

        results.push({
          source: 'writing-buddy',
          sourceId: user.id,
          hubId,
          username: hubUser.username,
          email: user.email,
        })

        logger.info('migrated writing-buddy child user', {
          operation: 'migrateUser',
          sourceId: user.id,
          hubId,
          parentId: hubParentId,
        })
      }

      logger.info('writing-buddy migration complete', {
        total: wbUsers.length,
        migrated: results.filter((r) => r.source === 'writing-buddy').length,
      })
    }

    // Summary
    logger.info('user migration complete', {
      operation: 'migrationSummary',
      totalMigrated: results.length,
      vocabMaster: results.filter((r) => r.source === 'vocab-master').length,
      writingBuddy: results.filter((r) => r.source === 'writing-buddy').length,
      dryRun: options.dryRun ?? false,
    })

    // Print summary table
    process.stdout.write('\n=== Migration Summary ===\n')
    process.stdout.write(`Total users migrated: ${results.length}\n`)
    process.stdout.write(
      `  vocab-master: ${results.filter((r) => r.source === 'vocab-master').length}\n`,
    )
    process.stdout.write(
      `  writing-buddy: ${results.filter((r) => r.source === 'writing-buddy').length}\n`,
    )
    if (options.dryRun) {
      process.stdout.write('\n(DRY RUN — no changes were made)\n')
    }
  } finally {
    await closeDb(sql)
  }
}

// --- CLI entrypoint ---

function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2)
  const options: MigrationOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]
    if (arg === '--vocab-master' && next) {
      options.vocabMasterDbPath = next
      i++
    } else if (arg === '--writing-buddy' && next) {
      options.writingBuddyDbPath = next
      i++
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--help') {
      process.stdout.write(`
Usage: npx tsx src/db/migrate-users.ts [options]

Options:
  --vocab-master <path>    Path to vocab-master SQLite database
  --writing-buddy <path>   Path to writing-buddy SQLite database
  --dry-run                Preview migration without making changes
  --help                   Show this help

Examples:
  npx tsx src/db/migrate-users.ts --vocab-master ../vocab-master/packages/backend/data/vocab-master.db --dry-run
  npx tsx src/db/migrate-users.ts --writing-buddy ../writing-buddy/packages/backend/data/writing-buddy.db
  npx tsx src/db/migrate-users.ts --vocab-master /path/to/vm.db --writing-buddy /path/to/wb.db
`)
      process.exit(0)
    }
  }

  if (!options.vocabMasterDbPath && !options.writingBuddyDbPath) {
    process.stderr.write(
      'Error: At least one source database must be specified.\nRun with --help for usage.\n',
    )
    process.exit(1)
  }

  return options
}

const options = parseArgs()
migrateUsers(options).catch((err) => {
  logger.error('migration failed', {
    operation: 'migrationError',
    error: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
