import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'
import type postgres from 'postgres'
import {
  loadMigrations,
  ensureMigrationsTable,
  getAppliedMigrations,
  migrateUp,
  migrateDown,
} from './migrator.js'

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}))

function createMockSql() {
  const txMock = {
    unsafe: vi.fn().mockResolvedValue([]),
  }

  const sql = Object.assign(vi.fn().mockResolvedValue([]), {
    unsafe: vi.fn().mockResolvedValue([]),
    begin: vi.fn(async (cb: (tx: typeof txMock) => Promise<void>) => {
      await cb(txMock)
    }),
  })

  return { sql: sql as unknown as postgres.Sql, txMock }
}

describe('loadMigrations', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty array when directory does not exist', async () => {
    const { readdir } = await import('fs/promises')
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'))

    const result = await loadMigrations('/nonexistent')
    expect(result).toEqual([])
  })

  it('loads and parses migration files in order', async () => {
    const { readdir, readFile } = await import('fs/promises')
    const dir = '/migrations'

    vi.mocked(readdir).mockResolvedValue([
      '002-applications.sql' as never,
      '001-users.sql' as never,
      'readme.txt' as never,
    ])

    vi.mocked(readFile).mockImplementation((path) => {
      const p = path as string
      if (p === join(dir, '001-users.sql')) {
        return Promise.resolve('-- up\nCREATE TABLE users (id SERIAL);\n-- down\nDROP TABLE users;')
      }
      if (p === join(dir, '002-applications.sql')) {
        return Promise.resolve(
          '-- up\nCREATE TABLE applications (id SERIAL);\n-- down\nDROP TABLE applications;',
        )
      }
      return Promise.reject(new Error('not found'))
    })

    const migrations = await loadMigrations(dir)

    expect(migrations).toHaveLength(2)
    expect(migrations[0]).toEqual({
      version: '001',
      name: 'users',
      up: 'CREATE TABLE users (id SERIAL);',
      down: 'DROP TABLE users;',
    })
    expect(migrations[1]).toEqual({
      version: '002',
      name: 'applications',
      up: 'CREATE TABLE applications (id SERIAL);',
      down: 'DROP TABLE applications;',
    })
  })

  it('skips files without valid migration naming', async () => {
    const { readdir, readFile } = await import('fs/promises')

    vi.mocked(readdir).mockResolvedValue(['random.sql' as never, 'no-version.sql' as never])
    vi.mocked(readFile).mockResolvedValue('-- up\nSELECT 1;\n-- down\nSELECT 1;')

    const migrations = await loadMigrations('/dir')
    expect(migrations).toHaveLength(0)
  })

  it('handles migration with only up section', async () => {
    const { readdir, readFile } = await import('fs/promises')

    vi.mocked(readdir).mockResolvedValue(['001-init.sql' as never])
    vi.mocked(readFile).mockResolvedValue('-- up\nCREATE TABLE foo (id INT);')

    const migrations = await loadMigrations('/dir')
    expect(migrations).toHaveLength(1)
    expect(migrations[0]?.up).toBe('CREATE TABLE foo (id INT);')
    expect(migrations[0]?.down).toBe('')
  })

  it('handles hyphenated migration names', async () => {
    const { readdir, readFile } = await import('fs/promises')

    vi.mocked(readdir).mockResolvedValue(['003-user-app-access.sql' as never])
    vi.mocked(readFile).mockResolvedValue('-- up\nCREATE TABLE t (id INT);\n-- down\nDROP TABLE t;')

    const migrations = await loadMigrations('/dir')
    expect(migrations).toHaveLength(1)
    expect(migrations[0]?.version).toBe('003')
    expect(migrations[0]?.name).toBe('user-app-access')
  })
})

describe('ensureMigrationsTable', () => {
  it('executes CREATE TABLE IF NOT EXISTS', async () => {
    const { sql } = createMockSql()
    await ensureMigrationsTable(sql)
    expect(sql).toHaveBeenCalled()
  })
})

describe('getAppliedMigrations', () => {
  it('returns applied migrations sorted by version', async () => {
    const mockRows = [
      { version: '001', name: 'users', applied_at: new Date('2026-01-01') },
      { version: '002', name: 'apps', applied_at: new Date('2026-01-02') },
    ]
    const sql = vi.fn().mockResolvedValue(mockRows) as unknown as postgres.Sql

    const result = await getAppliedMigrations(sql)
    expect(result).toEqual(mockRows)
    expect(result).toHaveLength(2)
  })

  it('returns empty array when no migrations applied', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as postgres.Sql
    const result = await getAppliedMigrations(sql)
    expect(result).toEqual([])
  })
})

describe('migrateUp', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('applies pending migrations', async () => {
    const { readdir, readFile } = await import('fs/promises')
    vi.mocked(readdir).mockResolvedValue(['001-users.sql' as never])
    vi.mocked(readFile).mockResolvedValue(
      '-- up\nCREATE TABLE users (id SERIAL);\n-- down\nDROP TABLE users;',
    )

    const { sql, txMock } = createMockSql()

    // ensureMigrationsTable + getAppliedMigrations
    vi.mocked(sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // ensureMigrationsTable
      .mockResolvedValueOnce([]) // getAppliedMigrations (no applied)

    const result = await migrateUp(sql, '/migrations')

    expect(result).toEqual(['001-users'])
    expect(txMock.unsafe).toHaveBeenCalledTimes(2)
    expect(txMock.unsafe).toHaveBeenCalledWith('CREATE TABLE users (id SERIAL);')
  })

  it('skips already applied migrations', async () => {
    const { readdir, readFile } = await import('fs/promises')
    vi.mocked(readdir).mockResolvedValue(['001-users.sql' as never])
    vi.mocked(readFile).mockResolvedValue(
      '-- up\nCREATE TABLE users (id SERIAL);\n-- down\nDROP TABLE users;',
    )

    const { sql } = createMockSql()
    vi.mocked(sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // ensureMigrationsTable
      .mockResolvedValueOnce([{ version: '001', name: 'users', applied_at: new Date() }])

    const result = await migrateUp(sql, '/migrations')

    expect(result).toEqual([])
  })

  it('throws when migration has no UP section', async () => {
    const { readdir, readFile } = await import('fs/promises')
    vi.mocked(readdir).mockResolvedValue(['001-broken.sql' as never])
    vi.mocked(readFile).mockResolvedValue('-- down\nDROP TABLE t;')

    const { sql } = createMockSql()
    vi.mocked(sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await expect(migrateUp(sql, '/migrations')).rejects.toThrow('has no UP section')
  })
})

describe('migrateDown', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('rolls back the last migration', async () => {
    const { readdir, readFile } = await import('fs/promises')
    vi.mocked(readdir).mockResolvedValue(['001-users.sql' as never])
    vi.mocked(readFile).mockResolvedValue(
      '-- up\nCREATE TABLE users (id SERIAL);\n-- down\nDROP TABLE users;',
    )

    const { sql, txMock } = createMockSql()
    vi.mocked(sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // ensureMigrationsTable
      .mockResolvedValueOnce([{ version: '001', name: 'users', applied_at: new Date() }])

    const result = await migrateDown(sql, '/migrations', 1)

    expect(result).toEqual(['001-users'])
    expect(txMock.unsafe).toHaveBeenCalledWith('DROP TABLE users;')
  })

  it('returns empty when no migrations to roll back', async () => {
    const { readdir } = await import('fs/promises')
    vi.mocked(readdir).mockResolvedValue([])

    const { sql } = createMockSql()
    vi.mocked(sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await migrateDown(sql, '/migrations', 1)
    expect(result).toEqual([])
  })

  it('throws when migration has no DOWN section', async () => {
    const { readdir, readFile } = await import('fs/promises')
    vi.mocked(readdir).mockResolvedValue(['001-init.sql' as never])
    vi.mocked(readFile).mockResolvedValue('-- up\nCREATE TABLE t (id INT);')

    const { sql } = createMockSql()
    vi.mocked(sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ version: '001', name: 'init', applied_at: new Date() }])

    await expect(migrateDown(sql, '/migrations', 1)).rejects.toThrow('has no DOWN section')
  })
})
