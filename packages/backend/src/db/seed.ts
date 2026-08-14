import { createHash } from 'crypto'
import { pathToFileURL } from 'url'
import { createDb, closeDb } from './connection.js'
import { env } from '../config/env.js'
import bcrypt from 'bcrypt'
import type postgres from 'postgres'

const BCRYPT_ROUNDS = 12

function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Idempotent startup bootstrap. Safe to run on every production boot:
 * ensures the admin user and the hub's own OIDC client row exist.
 *
 * Demo data (parent/student users, child-app registrations with dev client
 * secrets) is ONLY inserted when `seedDemo` is true — never in production.
 */
export async function runSeed(
  sql: postgres.Sql,
  options: { seedDemo: boolean } = { seedDemo: env.SEED_ON_STARTUP },
): Promise<void> {
  const adminId = await ensureAdminUser(sql)
  await ensureHubClient(sql)

  if (options.seedDemo) {
    await seedDemoData(sql)
  } else {
    process.stdout.write('Demo data seeding skipped (SEED_ON_STARTUP not enabled).\n')
  }

  if (adminId) {
    await ensureAdminEntitlements(sql, adminId)
  }
}

/** Create the admin user if missing. Never resets an existing password. */
async function ensureAdminUser(sql: postgres.Sql): Promise<number | null> {
  const adminUsername = process.env.ADMIN_USERNAME
  const adminDisplayName = process.env.ADMIN_DISPLAY_NAME
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPass = process.env.ADMIN_PASSWORD

  if (!adminUsername || !adminPass || !adminEmail || !adminDisplayName) {
    throw new Error(
      'Missing required env vars: ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL, ADMIN_DISPLAY_NAME',
    )
  }

  const adminPassword = await bcrypt.hash(adminPass, BCRYPT_ROUNDS)

  const [admin] = await sql`
    INSERT INTO users (username, email, password_hash, display_name, role, email_verified)
    VALUES (${adminUsername}, ${adminEmail}, ${adminPassword}, ${adminDisplayName}, 'admin', true)
    ON CONFLICT (username) DO NOTHING
    RETURNING id
  `

  if (admin) {
    return admin.id as number
  }

  const existing = (await sql`SELECT id FROM users WHERE username = ${adminUsername}`)[0]
  return existing ? (existing.id as number) : null
}

/**
 * Ensure the hub is registered as its own OIDC client. ON CONFLICT updates
 * only url/redirect_uris (so issuer changes propagate) — never the rotated
 * client secrets. No backchannel_logout_uri: the hub initiates logout itself
 * and already destroys its own session; registering one creates a circular
 * BCL request during logout.
 */
async function ensureHubClient(sql: postgres.Sql): Promise<void> {
  const hubSecretHash = await bcrypt.hash('hub-dev-client-secret', BCRYPT_ROUNDS)
  const hubSecretSha256 = hashSha256('hub-dev-client-secret')

  const hubIssuer = process.env.OIDC_ISSUER ?? 'http://localhost:3009'
  const hubRedirectUris = [
    `${hubIssuer}/api/auth/hub-callback`,
    // Include both dev and prod so the same bootstrap works everywhere
    ...(hubIssuer !== 'http://localhost:3009'
      ? ['http://localhost:3009/api/auth/hub-callback']
      : []),
    ...(hubIssuer !== 'https://hub.labf.app'
      ? ['https://hub.labf.app/api/auth/hub-callback']
      : []),
  ]

  await sql`
    INSERT INTO applications (name, slug, url, client_id, client_secret_hash, client_secret_sha256, redirect_uris)
    VALUES (
      '11plus Hub', 'hub', ${hubIssuer},
      'hub', ${hubSecretHash}, ${hubSecretSha256},
      ${sql.array(hubRedirectUris)}
    )
    ON CONFLICT (slug) DO UPDATE SET
      url = EXCLUDED.url,
      redirect_uris = EXCLUDED.redirect_uris,
      backchannel_logout_uri = NULL
  `
}

/**
 * Development-only demo data. Never call this in production — it inserts
 * users with publicly-known passwords and app registrations with
 * publicly-known client secrets.
 */
async function seedDemoData(sql: postgres.Sql): Promise<void> {
  const parentPassword = await bcrypt.hash('parent123!@#', BCRYPT_ROUNDS)
  const studentPassword = await bcrypt.hash('student123!@#', BCRYPT_ROUNDS)

  // Create parent user
  const [parent] = await sql`
    INSERT INTO users (username, email, password_hash, display_name, role, email_verified)
    VALUES ('parent1', 'parent@example.com', ${parentPassword}, 'Sarah Wang', 'parent', true)
    ON CONFLICT (username) DO NOTHING
    RETURNING id
  `

  // Create student user
  await sql`
    INSERT INTO users (username, email, password_hash, display_name, role, parent_id, email_verified)
    VALUES ('emma', 'emma@example.com', ${studentPassword}, 'Emma Wang', 'student', ${parent?.id ?? null}, true)
    ON CONFLICT (username) DO NOTHING
  `

  // Register demo apps (store both bcrypt hash and SHA-256 hash)
  const vocabSecretHash = await bcrypt.hash('vocab-dev-secret', BCRYPT_ROUNDS)
  const vocabSecretSha256 = hashSha256('vocab-dev-secret')
  const writingSecretHash = await bcrypt.hash('writing-dev-secret', BCRYPT_ROUNDS)
  const writingSecretSha256 = hashSha256('writing-dev-secret')
  const storySleuthSecretHash = await bcrypt.hash('story-sleuth-dev-secret', BCRYPT_ROUNDS)
  const storySleuthSecretSha256 = hashSha256('story-sleuth-dev-secret')

  await sql`
    INSERT INTO applications (name, slug, url, client_id, client_secret_hash, client_secret_sha256, redirect_uris, backchannel_logout_uri, stats_api_url)
    VALUES (
      'Vocab Master', 'vocab-master', 'https://vocab-master.labf.app',
      'vocab-master-client', ${vocabSecretHash}, ${vocabSecretSha256},
      ARRAY['https://vocab-master.labf.app/auth/callback', 'http://localhost:5174/auth/callback', 'http://localhost:5173/auth/callback'],
      'http://localhost:5174/auth/backchannel-logout',
      'https://vocab-master.labf.app/api/stats'
    )
    ON CONFLICT (slug) DO UPDATE SET
      redirect_uris = EXCLUDED.redirect_uris,
      backchannel_logout_uri = EXCLUDED.backchannel_logout_uri
  `

  await sql`
    INSERT INTO applications (name, slug, url, client_id, client_secret_hash, client_secret_sha256, redirect_uris, backchannel_logout_uri)
    VALUES (
      'Writing Buddy', 'writing-buddy', 'https://writing-buddy.labf.app',
      'writing-buddy-client', ${writingSecretHash}, ${writingSecretSha256},
      ARRAY['https://writing-buddy.labf.app/api/auth/callback', 'http://localhost:5179/api/auth/callback', 'http://localhost:5055/api/auth/callback'],
      'http://localhost:5050/api/auth/backchannel-logout'
    )
    ON CONFLICT (slug) DO UPDATE SET
      redirect_uris = EXCLUDED.redirect_uris,
      backchannel_logout_uri = EXCLUDED.backchannel_logout_uri
  `

  await sql`
    INSERT INTO applications (name, slug, url, client_id, client_secret_hash, client_secret_sha256, redirect_uris, backchannel_logout_uri)
    VALUES (
      'Story Sleuth', 'story-sleuth', 'https://story-sleuth.labf.app',
      'story-sleuth-client', ${storySleuthSecretHash}, ${storySleuthSecretSha256},
      ARRAY['https://story-sleuth.labf.app/api/auth/callback', 'http://localhost:5180/api/auth/callback'],
      'http://localhost:5181/api/auth/backchannel-logout'
    )
    ON CONFLICT (slug) DO UPDATE SET
      redirect_uris = EXCLUDED.redirect_uris,
      backchannel_logout_uri = EXCLUDED.backchannel_logout_uri
  `
}

/** Give the admin a bundle plan + access to all registered apps (idempotent). */
async function ensureAdminEntitlements(sql: postgres.Sql, adminId: number): Promise<void> {
  await sql`
    INSERT INTO subscriptions (user_id, plan, status, features, assigned_by)
    VALUES (${adminId}, 'bundle', 'active', ARRAY['writing', 'vocab', 'story-sleuth'], ${adminId})
    ON CONFLICT (user_id) WHERE status IN ('active', 'trial')
    DO UPDATE SET features = EXCLUDED.features
  `

  // Grant app access for all registered apps (including newly seeded ones)
  await sql`
    INSERT INTO user_app_access (user_id, app_id)
    SELECT ${adminId}, id FROM applications
    ON CONFLICT DO NOTHING
  `
}

async function main(): Promise<void> {
  const sql = createDb()

  try {
    await runSeed(sql)
    process.stdout.write('Seed data inserted successfully.\n')
  } finally {
    await closeDb(sql)
  }
}

// Run only when executed as a CLI entry point (`node dist/db/seed.js`),
// never when imported (tests).
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
