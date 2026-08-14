import { describe, it, expect, vi, beforeEach } from 'vitest'
import type postgres from 'postgres'
import { loadCorsOriginsFromRegistry } from './registry-cors.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

type SqlStub = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
  __rows: unknown[]
}

function createSqlStub(rows: unknown[]): SqlStub {
  const fn = (async () => rows) as SqlStub
  fn.__rows = rows
  return fn
}

describe('loadCorsOriginsFromRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('collects origins from app urls and redirect_uris', async () => {
    const sql = createSqlStub([
      {
        url: 'https://vocab-master.labf.app',
        redirect_uris: [
          'https://vocab-master.labf.app/auth/callback',
          'http://localhost:5174/auth/callback',
        ],
      },
      {
        url: 'https://writing-buddy.labf.app',
        redirect_uris: ['https://writing-buddy.labf.app/api/auth/callback'],
      },
    ])

    const origins = await loadCorsOriginsFromRegistry(sql as unknown as postgres.Sql)

    expect(origins).toContain('https://vocab-master.labf.app')
    expect(origins).toContain('http://localhost:5174')
    expect(origins).toContain('https://writing-buddy.labf.app')
    // Deduplicated, no duplicates
    expect(origins).toHaveLength(3)
  })

  it('skips null and malformed URIs', async () => {
    const sql = createSqlStub([
      { url: null, redirect_uris: null },
      { url: 'not-a-url', redirect_uris: ['https://ok.labf.app/cb', ':::bad:::'] },
    ])

    const origins = await loadCorsOriginsFromRegistry(sql as unknown as postgres.Sql)

    expect(origins).toEqual(['https://ok.labf.app'])
  })

  it('returns an empty list when the registry query fails', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db down'))

    const origins = await loadCorsOriginsFromRegistry(sql as unknown as postgres.Sql)

    expect(origins).toEqual([])
  })
})
