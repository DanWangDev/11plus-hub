import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { createDb, closeDb } from './connection.js'
import { migrateUp, migrateDown, getAppliedMigrations, ensureMigrationsTable } from './migrator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up'
  const steps = Number(process.argv[3]) || 1
  const sql = createDb()

  try {
    switch (command) {
      case 'up': {
        const applied = await migrateUp(sql, MIGRATIONS_DIR)
        if (applied.length === 0) {
          process.stdout.write('No pending migrations.\n')
        } else {
          process.stdout.write(`Applied ${applied.length} migration(s):\n`)
          applied.forEach((m) => process.stdout.write(`  ✓ ${m}\n`))
        }
        break
      }
      case 'down': {
        const rolledBack = await migrateDown(sql, MIGRATIONS_DIR, steps)
        if (rolledBack.length === 0) {
          process.stdout.write('No migrations to roll back.\n')
        } else {
          process.stdout.write(`Rolled back ${rolledBack.length} migration(s):\n`)
          rolledBack.forEach((m) => process.stdout.write(`  ↩ ${m}\n`))
        }
        break
      }
      case 'status': {
        await ensureMigrationsTable(sql)
        const applied = await getAppliedMigrations(sql)
        if (applied.length === 0) {
          process.stdout.write('No migrations applied.\n')
        } else {
          process.stdout.write(`Applied migrations:\n`)
          applied.forEach((m) =>
            process.stdout.write(`  ✓ ${m.version}-${m.name} (${m.applied_at})\n`),
          )
        }
        break
      }
      default:
        process.stderr.write(`Unknown command: ${command}\n`)
        process.stderr.write('Usage: db:migrate [up|down|status] [steps]\n')
        process.exit(1)
    }
  } finally {
    await closeDb(sql)
  }
}

main().catch((err) => {
  process.stderr.write(`Migration failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
