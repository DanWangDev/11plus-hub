/**
 * One-time migration: port pre-SSO writing-buddy users into hub PostgreSQL
 * and remap their writing data (submissions, revisions, etc.) to hub user IDs.
 *
 * Usage:
 *   npx tsx src/db/migrate-writing-buddy.ts --db data/writing-buddy.db --dry-run
 *   npx tsx src/db/migrate-writing-buddy.ts --db data/writing-buddy.db
 *
 * Special handling:
 *   - User with display_name containing "daniel" (case-insensitive) or username
 *     "BigDaddy" is merged with the existing hub user "kill_skirk"
 *   - All other users are created as new hub users
 *   - Writing data (submissions, revisions, coaching, scores, progress) is
 *     remapped from old UUID user_id to the hub numeric user ID (as TEXT)
 */

import Database from 'better-sqlite3'
import { createDb, closeDb } from './connection.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'migrate-writing-buddy' })

const MERGE_TARGET_USERNAME = 'kill_skirk'

// --- Source types ---

interface WbUser {
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

interface MigrationMapping {
  oldUserId: string
  hubUserId: number
  hubUsername: string
  action: 'merged' | 'created'
}

// --- Helpers ---

function isDanielUser(user: WbUser): boolean {
  const name = (user.display_name ?? '').toLowerCase()
  const email = (user.email ?? '').toLowerCase()
  return (
    name.includes('daniel') ||
    email === 'bigdaddy' ||
    name === 'admin'
  )
}

function mapRole(role: string): string {
  const roleMap: Record<string, string> = {
    student: 'student',
    parent: 'parent',
    admin: 'admin',
    tutor: 'parent',
  }
  return roleMap[role] ?? 'student'
}

function generateUsername(email: string, existing: Set<string>): string {
  const base = email.split('@')[0]?.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'user'
  const trimmed = base.slice(0, 27)
  if (trimmed.length >= 3 && !existing.has(trimmed)) {
    existing.add(trimmed)
    return trimmed
  }
  let counter = 1
  let candidate = `${trimmed}_${counter}`
  while (existing.has(candidate)) {
    counter++
    candidate = `${trimmed}_${counter}`
  }
  existing.add(candidate)
  return candidate
}

// --- Main migration ---

async function migrate(dbPath: string, dryRun: boolean): Promise<void> {
  const sqlite = new Database(dbPath, { readonly: dryRun })
  const sql = createDb()
  const mappings: MigrationMapping[] = []

  try {
    // 1. Read all writing-buddy users
    const wbUsers = sqlite.prepare('SELECT * FROM users').all() as WbUser[]
    logger.info('writing-buddy users loaded', { count: wbUsers.length })

    if (wbUsers.length === 0) {
      process.stdout.write('No users found in writing-buddy database.\n')
      return
    }

    // 2. Load existing hub usernames
    const existingUsernames = new Set<string>()
    const hubUsers = await sql`SELECT id, username FROM users`
    for (const row of hubUsers) {
      existingUsernames.add((row as { username: string }).username)
    }

    // 3. Find the merge target (kill_skirk)
    const mergeTargetRows = await sql`
      SELECT id, username, display_name, email FROM users
      WHERE username = ${MERGE_TARGET_USERNAME}
    `
    const mergeTarget = mergeTargetRows[0] as
      | { id: number; username: string; display_name: string; email: string }
      | undefined

    if (!mergeTarget) {
      logger.warn('merge target not found in hub', { username: MERGE_TARGET_USERNAME })
      process.stdout.write(
        `WARNING: Hub user "${MERGE_TARGET_USERNAME}" not found. Daniel user will be created as new.\n`,
      )
    } else {
      logger.info('merge target found', {
        hubId: mergeTarget.id,
        username: mergeTarget.username,
        displayName: mergeTarget.display_name,
      })
    }

    // 4. Process each writing-buddy user
    for (const wbUser of wbUsers) {
      const shouldMerge = isDanielUser(wbUser) && mergeTarget

      if (shouldMerge) {
        // Merge with kill_skirk
        logger.info('merging writing-buddy user with hub user', {
          wbId: wbUser.id,
          wbDisplayName: wbUser.display_name,
          hubId: mergeTarget.id,
          hubUsername: mergeTarget.username,
        })

        mappings.push({
          oldUserId: wbUser.id,
          hubUserId: mergeTarget.id,
          hubUsername: mergeTarget.username,
          action: 'merged',
        })
      } else {
        // Create new hub user
        const username = generateUsername(wbUser.email, existingUsernames)
        const role = mapRole(wbUser.role)
        const email = wbUser.email.includes('@') ? wbUser.email : `${wbUser.email}@migrated.local`

        if (dryRun) {
          logger.info('dry run: would create hub user', {
            username,
            email,
            role,
            wbId: wbUser.id,
          })
          mappings.push({
            oldUserId: wbUser.id,
            hubUserId: -1,
            hubUsername: username,
            action: 'created',
          })
          continue
        }

        const rows = await sql`
          INSERT INTO users (username, email, password_hash, display_name, role, email_verified, created_at)
          VALUES (
            ${username},
            ${email},
            ${wbUser.password_hash},
            ${wbUser.display_name},
            ${role},
            false,
            ${wbUser.created_at ?? new Date().toISOString()}
          )
          ON CONFLICT (email) DO UPDATE SET
            password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
            display_name = COALESCE(NULLIF(users.display_name, ''), EXCLUDED.display_name)
          RETURNING id
        `
        const hubId = (rows[0] as { id: number }).id

        mappings.push({
          oldUserId: wbUser.id,
          hubUserId: hubId,
          hubUsername: username,
          action: 'created',
        })

        logger.info('created hub user', {
          wbId: wbUser.id,
          hubId,
          username,
        })
      }
    }

    // 5. Grant writing-buddy app access for all migrated users
    const appRows = await sql`SELECT id FROM applications WHERE slug = 'writing-buddy'`
    const appId = (appRows[0] as { id: number } | undefined)?.id

    if (!appId) {
      logger.warn('writing-buddy app not found in hub — skipping app access grants')
    }

    for (const mapping of mappings) {
      if (dryRun || mapping.hubUserId === -1) continue

      if (appId) {
        await sql`
          INSERT INTO user_app_access (user_id, app_id)
          VALUES (${mapping.hubUserId}, ${appId})
          ON CONFLICT DO NOTHING
        `
        logger.info('granted writing-buddy access', {
          hubId: mapping.hubUserId,
          username: mapping.hubUsername,
        })
      }

      // Create subscription if not exists
      await sql`
        INSERT INTO subscriptions (user_id, plan, status, features)
        VALUES (${mapping.hubUserId}, 'writing', 'active', ARRAY['writing'])
        ON CONFLICT DO NOTHING
      `
    }

    // 6. Remap user_id in writing-buddy SQLite tables
    if (!dryRun) {
      for (const mapping of mappings) {
        const oldId = mapping.oldUserId
        const newId = String(mapping.hubUserId)

        logger.info('remapping writing-buddy data', {
          oldUserId: oldId,
          newUserId: newId,
          hubUsername: mapping.hubUsername,
        })

        // Update submissions.user_id
        const subCount = sqlite
          .prepare('UPDATE submissions SET user_id = ? WHERE user_id = ?')
          .run(newId, oldId)
        logger.info('remapped submissions', { count: subCount.changes })

        // Update writing_progress.user_id
        const progCount = sqlite
          .prepare('UPDATE writing_progress SET user_id = ? WHERE user_id = ?')
          .run(newId, oldId)
        logger.info('remapped writing_progress', { count: progCount.changes })

        // Update the user record itself to store the hub mapping
        sqlite
          .prepare('UPDATE users SET email = ?, display_name = ? WHERE id = ?')
          .run(
            `hub:${mapping.hubUserId}`,
            `${mapping.hubUsername} (migrated to hub)`,
            oldId,
          )
      }
    }

    // 7. Print summary
    process.stdout.write('\n=== Writing-Buddy Migration Summary ===\n')
    process.stdout.write(`Users processed: ${mappings.length}\n`)
    for (const m of mappings) {
      const idStr = m.hubUserId === -1 ? '(dry run)' : String(m.hubUserId)
      process.stdout.write(
        `  ${m.action.toUpperCase()}: wb:${m.oldUserId.slice(0, 8)}... → hub:${idStr} (${m.hubUsername})\n`,
      )
    }

    // Count writing data that was remapped
    const subTotal = sqlite.prepare('SELECT COUNT(*) as c FROM submissions').get() as { c: number }
    const revTotal = sqlite.prepare('SELECT COUNT(*) as c FROM revisions').get() as { c: number }
    const coachTotal = sqlite.prepare('SELECT COUNT(*) as c FROM coaching_passes').get() as {
      c: number
    }
    const scoreTotal = sqlite.prepare('SELECT COUNT(*) as c FROM rubric_scores').get() as {
      c: number
    }
    const progTotal = sqlite.prepare('SELECT COUNT(*) as c FROM writing_progress').get() as {
      c: number
    }

    process.stdout.write(`\nWriting data in scope:\n`)
    process.stdout.write(`  Submissions:     ${subTotal.c}\n`)
    process.stdout.write(`  Revisions:       ${revTotal.c}\n`)
    process.stdout.write(`  Coaching passes: ${coachTotal.c}\n`)
    process.stdout.write(`  Rubric scores:   ${scoreTotal.c}\n`)
    process.stdout.write(`  Progress days:   ${progTotal.c}\n`)

    if (dryRun) {
      process.stdout.write('\n(DRY RUN — no changes were made)\n')
    } else {
      process.stdout.write('\nMigration complete. Writing data remapped to hub user IDs.\n')
    }
  } finally {
    sqlite.close()
    await closeDb(sql)
  }
}

// --- CLI ---

function parseArgs(): { dbPath: string; dryRun: boolean } {
  const args = process.argv.slice(2)
  let dbPath = ''
  let dryRun = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--db' && args[i + 1]) {
      dbPath = args[++i]
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--help') {
      process.stdout.write(`
Usage: npx tsx src/db/migrate-writing-buddy.ts --db <path> [--dry-run]

Migrates pre-SSO writing-buddy users into hub PostgreSQL and remaps
writing data (submissions, revisions, coaching, scores, progress)
to hub user IDs.

Special: user "BigDaddy"/"Admin"/"daniel" is merged with hub user "${MERGE_TARGET_USERNAME}".

Options:
  --db <path>    Path to writing-buddy SQLite database
  --dry-run      Preview migration without making changes
  --help         Show this help

Examples:
  npx tsx src/db/migrate-writing-buddy.ts --db data/writing-buddy.db --dry-run
  npx tsx src/db/migrate-writing-buddy.ts --db data/writing-buddy.db
`)
      process.exit(0)
    }
  }

  if (!dbPath) {
    process.stderr.write('Error: --db <path> is required.\nRun with --help for usage.\n')
    process.exit(1)
  }

  return { dbPath, dryRun }
}

const { dbPath, dryRun } = parseArgs()
migrate(dbPath, dryRun).catch((err) => {
  logger.error('migration failed', {
    operation: 'migrationError',
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  })
  process.exit(1)
})
