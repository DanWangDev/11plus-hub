import { createDb, closeDb } from './connection.js'
import bcrypt from 'bcrypt'

const BCRYPT_ROUNDS = 12

async function main(): Promise<void> {
  const sql = createDb()

  try {
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
    const parentPassword = await bcrypt.hash('parent123!@#', BCRYPT_ROUNDS)
    const studentPassword = await bcrypt.hash('student123!@#', BCRYPT_ROUNDS)

    // Create admin user
    const [admin] = await sql`
      INSERT INTO users (username, email, password_hash, display_name, role, email_verified)
      VALUES (${adminUsername}, ${adminEmail}, ${adminPassword}, ${adminDisplayName}, 'admin', true)
      ON CONFLICT (username) DO NOTHING
      RETURNING id
    `

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

    // Register apps
    const vocabSecret = await bcrypt.hash('vocab-dev-secret', BCRYPT_ROUNDS)
    const writingSecret = await bcrypt.hash('writing-dev-secret', BCRYPT_ROUNDS)

    await sql`
      INSERT INTO applications (name, slug, url, client_id, client_secret_hash, redirect_uris, stats_api_url)
      VALUES (
        'Vocab Master', 'vocab-master', 'https://vocab-master.labf.app',
        'vocab-master-client', ${vocabSecret},
        ARRAY['https://vocab-master.labf.app/auth/callback', 'http://localhost:5174/auth/callback'],
        'https://vocab-master.labf.app/api/stats'
      )
      ON CONFLICT (slug) DO NOTHING
    `

    await sql`
      INSERT INTO applications (name, slug, url, client_id, client_secret_hash, redirect_uris)
      VALUES (
        'Writing Buddy', 'writing-buddy', 'https://writing-buddy.labf.app',
        'writing-buddy-client', ${writingSecret},
        ARRAY['https://writing-buddy.labf.app/auth/callback', 'http://localhost:5175/auth/callback']
      )
      ON CONFLICT (slug) DO NOTHING
    `

    // Create free subscription for admin
    if (admin?.id) {
      await sql`
        INSERT INTO subscriptions (user_id, plan, status, features, assigned_by)
        VALUES (${admin.id}, 'bundle', 'active', ARRAY['writing', 'vocab'], ${admin.id})
        ON CONFLICT DO NOTHING
      `
    }

    process.stdout.write('Seed data inserted successfully.\n')
  } finally {
    await closeDb(sql)
  }
}

main().catch((err) => {
  process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
