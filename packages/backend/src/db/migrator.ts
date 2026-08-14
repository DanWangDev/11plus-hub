import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type postgres from 'postgres'

/** Arbitrary app-specific key for pg_advisory_xact_lock. */
const MIGRATION_LOCK_KEY = 682015001

export interface Migration {
  version: string
  name: string
  up: string
  down: string
}

export interface MigrationRecord {
  version: string
  name: string
  applied_at: Date
}

export async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
}

export async function getAppliedMigrations(sql: postgres.Sql): Promise<MigrationRecord[]> {
  const rows = await sql<MigrationRecord[]>`
    SELECT version, name, applied_at
    FROM schema_migrations
    ORDER BY version ASC
  `
  return [...rows]
}

export async function loadMigrations(migrationsDir: string): Promise<Migration[]> {
  let files: string[]
  try {
    files = await readdir(migrationsDir)
  } catch {
    return []
  }

  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort()
  const migrations: Migration[] = []

  for (const file of sqlFiles) {
    const content = await readFile(join(migrationsDir, file), 'utf-8')
    const match = file.match(/^(\d+)[-_](.+)\.sql$/)
    if (!match) continue

    const [, version, name] = match
    if (!version || !name) continue

    const upMatch = content.match(/--\s*up\s*\n([\s\S]*?)(?=--\s*down\s*\n|$)/i)
    const downMatch = content.match(/--\s*down\s*\n([\s\S]*?)$/i)

    migrations.push({
      version,
      name,
      up: upMatch?.[1]?.trim() ?? '',
      down: downMatch?.[1]?.trim() ?? '',
    })
  }

  return migrations
}

export async function migrateUp(sql: postgres.Sql, migrationsDir: string): Promise<string[]> {
  // Serialize concurrent migrators (e.g. two app containers booting at
  // once) with a transaction-scoped advisory lock, and run the whole
  // migration in a single transaction on one connection. The lock releases
  // automatically at commit.
  return sql.begin(async (tx) => {
    await (tx as unknown as postgres.Sql)`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`

    await ensureMigrationsTable(tx as unknown as postgres.Sql)
    const applied = await getAppliedMigrations(tx as unknown as postgres.Sql)
    const appliedVersions = new Set(applied.map((m) => m.version))
    const migrations = await loadMigrations(migrationsDir)

    const pending = migrations.filter((m) => !appliedVersions.has(m.version))
    const appliedNames: string[] = []

    for (const migration of pending) {
      if (!migration.up) {
        throw new Error(`Migration ${migration.version}-${migration.name} has no UP section`)
      }

      await tx.unsafe(migration.up)
      await tx.unsafe('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ])

      appliedNames.push(`${migration.version}-${migration.name}`)
    }

    return appliedNames
  })
}

export async function migrateDown(
  sql: postgres.Sql,
  migrationsDir: string,
  steps = 1,
): Promise<string[]> {
  return sql.begin(async (tx) => {
    await (tx as unknown as postgres.Sql)`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`

    await ensureMigrationsTable(tx as unknown as postgres.Sql)
    const applied = await getAppliedMigrations(tx as unknown as postgres.Sql)
    const migrations = await loadMigrations(migrationsDir)

    const toRollback = applied.slice(-steps).reverse()
    const rolledBack: string[] = []

    for (const record of toRollback) {
      const migration = migrations.find((m) => m.version === record.version)
      if (!migration?.down) {
        throw new Error(`Migration ${record.version}-${record.name} has no DOWN section`)
      }

      await tx.unsafe(migration.down)
      await tx.unsafe('DELETE FROM schema_migrations WHERE version = $1', [record.version])

      rolledBack.push(`${record.version}-${record.name}`)
    }

    return rolledBack
  })
}
