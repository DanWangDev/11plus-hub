import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('postgres', () => {
  const mockSql = Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?')
      if (query.includes('SELECT 1')) {
        return Promise.resolve([{ ok: 1 }])
      }
      return Promise.resolve([])
    },
    {
      end: vi.fn().mockResolvedValue(undefined),
      begin: vi.fn(),
    },
  )

  return {
    default: vi.fn(() => mockSql),
  }
})

vi.mock('../config/env.js', () => ({
  env: {
    DATABASE_URL: undefined,
    DB_HOST: 'localhost',
    DB_PORT: 5432,
    DB_NAME: 'hub_test',
    DB_USER: 'hub',
    DB_PASSWORD: 'password',
  },
}))

describe('db/connection', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('createDb returns a postgres instance', async () => {
    const { createDb } = await import('./connection.js')
    const sql = createDb()
    expect(sql).toBeDefined()
    expect(typeof sql).toBe('function')
  })

  it('createDb accepts config overrides', async () => {
    const postgres = (await import('postgres')).default
    const { createDb } = await import('./connection.js')
    createDb({ host: 'custom-host', port: 5433 })
    expect(postgres).toHaveBeenCalled()
  })

  it('checkDbConnection returns true on success', async () => {
    const { createDb, checkDbConnection } = await import('./connection.js')
    const sql = createDb()
    const result = await checkDbConnection(sql)
    expect(result).toBe(true)
  })

  it('checkDbConnection returns false on failure', async () => {
    const { checkDbConnection } = await import('./connection.js')
    const failingSql = Object.assign(() => Promise.reject(new Error('connection refused')), {
      end: vi.fn(),
    }) as never
    const result = await checkDbConnection(failingSql)
    expect(result).toBe(false)
  })

  it('closeDb calls sql.end()', async () => {
    const { createDb, closeDb } = await import('./connection.js')
    const sql = createDb()
    await closeDb(sql)
    expect(sql.end).toHaveBeenCalled()
  })

  it('uses DATABASE_URL when set', async () => {
    vi.doMock('../config/env.js', () => ({
      env: {
        DATABASE_URL: 'postgresql://user:pass@dbhost:5433/mydb',
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_NAME: 'hub',
        DB_USER: 'hub',
        DB_PASSWORD: 'password',
      },
    }))

    const postgres = (await import('postgres')).default
    vi.mocked(postgres).mockClear()

    const { createDb } = await import('./connection.js')
    createDb()

    expect(postgres).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'dbhost',
        port: 5433,
        database: 'mydb',
        username: 'user',
        password: 'pass',
      }),
    )
  })
})
