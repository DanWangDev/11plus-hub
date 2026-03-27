import { createHash } from 'crypto'
import { createDb, closeDb } from './connection.js'
import bcrypt from 'bcrypt'

const BCRYPT_ROUNDS = 12

function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

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

    // Register apps (store both bcrypt hash and SHA-256 hash)
    const vocabSecretHash = await bcrypt.hash('vocab-dev-secret', BCRYPT_ROUNDS)
    const vocabSecretSha256 = hashSha256('vocab-dev-secret')
    const writingSecretHash = await bcrypt.hash('writing-dev-secret', BCRYPT_ROUNDS)
    const writingSecretSha256 = hashSha256('writing-dev-secret')
    const hubSecretHash = await bcrypt.hash('hub-dev-client-secret', BCRYPT_ROUNDS)
    const hubSecretSha256 = hashSha256('hub-dev-client-secret')

    // Hub self-registration as OIDC client (eats its own dog food)
    // Use OIDC_ISSUER so the url/redirect_uris/backchannel_logout_uri match the
    // production issuer. This ensures post_logout_redirect_uri validation works.
    const hubIssuer = process.env.OIDC_ISSUER ?? 'http://localhost:3009'
    const hubRedirectUris = [
      `${hubIssuer}/auth/callback`,
      // Include both dev and prod so the same seed works everywhere
      ...(hubIssuer !== 'http://localhost:3009' ? ['http://localhost:3009/auth/callback'] : []),
      ...(hubIssuer !== 'https://hub.labf.app' ? ['https://hub.labf.app/auth/callback'] : []),
    ]

    // ON CONFLICT: update url, redirect_uris, and backchannel_logout_uri
    // so re-running seed fixes stale data — never overwrite rotated secrets
    await sql`
      INSERT INTO applications (name, slug, url, client_id, client_secret_hash, client_secret_sha256, redirect_uris, backchannel_logout_uri)
      VALUES (
        '11plus Hub', 'hub', ${hubIssuer},
        'hub', ${hubSecretHash}, ${hubSecretSha256},
        ${sql.array(hubRedirectUris)},
        ${`${hubIssuer}/auth/backchannel-logout`}
      )
      ON CONFLICT (slug) DO UPDATE SET
        url = EXCLUDED.url,
        redirect_uris = EXCLUDED.redirect_uris,
        backchannel_logout_uri = EXCLUDED.backchannel_logout_uri
    `

    await sql`
      INSERT INTO applications (name, slug, url, client_id, client_secret_hash, client_secret_sha256, redirect_uris, backchannel_logout_uri, stats_api_url)
      VALUES (
        'Vocab Master', 'vocab-master', 'https://vocab-master.labf.app',
        'vocab-master-client', ${vocabSecretHash}, ${vocabSecretSha256},
        ARRAY['https://vocab-master.labf.app/auth/callback', 'http://localhost:5174/auth/callback'],
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

    // Create free subscription for admin
    if (admin?.id) {
      await sql`
        INSERT INTO subscriptions (user_id, plan, status, features, assigned_by)
        VALUES (${admin.id}, 'bundle', 'active', ARRAY['writing', 'vocab'], ${admin.id})
        ON CONFLICT DO NOTHING
      `

      // Grant app access for all registered apps
      await sql`
        INSERT INTO user_app_access (user_id, app_id)
        SELECT ${admin.id}, id FROM applications
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
