import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type postgres from 'postgres'

vi.mock('./connection.js', () => ({
  createDb: vi.fn(() => ({})),
  closeDb: vi.fn(async () => {}),
}))

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(async (pw: string) => `hash:${pw}`),
    compare: vi.fn(async () => false),
  },
  hash: vi.fn(async (pw: string) => `hash:${pw}`),
  compare: vi.fn(async () => false),
}))

import { runSeed } from './seed.js'

const DEMO_MARKERS = [
  'parent1',
  'emma',
  'vocab-master-client',
  'writing-buddy-client',
  'story-sleuth-client',
]

type CallableSql = ((strings: TemplateStringsArray, ...values: unknown[]) => unknown[]) & {
  calls: string[]
  array: (v: unknown[]) => unknown[]
}

function createSqlStub(results: Array<unknown[] | undefined> = []): CallableSql {
  let i = 0
  const fn = function (strings: TemplateStringsArray, ..._values: unknown[]): unknown[] {
    fn.calls.push(strings.join(''))
    const result = results[i]
    i += 1
    return result ?? []
  } as CallableSql
  fn.calls = []
  fn.array = (v: unknown[]) => v
  return fn
}

describe('runSeed', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_USERNAME', 'admin')
    vi.stubEnv('ADMIN_PASSWORD', 'admin123')
    vi.stubEnv('ADMIN_EMAIL', 'admin@labf.app')
    vi.stubEnv('ADMIN_DISPLAY_NAME', 'Admin')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('bootstraps admin + hub client but skips demo data when seedDemo is false', async () => {
    const sql = createSqlStub()
    await runSeed(sql as unknown as postgres.Sql, { seedDemo: false })

    expect(sql.calls.some((c) => c.includes("'admin'"))).toBe(true)
    expect(sql.calls.some((c) => c.includes("'11plus Hub'"))).toBe(true)
    for (const marker of DEMO_MARKERS) {
      expect(sql.calls.some((c) => c.includes(marker))).toBe(false)
    }
  })

  it('seeds demo users + demo app registrations when seedDemo is true', async () => {
    const sql = createSqlStub()
    await runSeed(sql as unknown as postgres.Sql, { seedDemo: true })

    expect(sql.calls.some((c) => c.includes('parent1'))).toBe(true)
    expect(sql.calls.some((c) => c.includes('emma'))).toBe(true)
    expect(sql.calls.some((c) => c.includes('vocab-master-client'))).toBe(true)
    expect(sql.calls.some((c) => c.includes('writing-buddy-client'))).toBe(true)
    expect(sql.calls.some((c) => c.includes('story-sleuth-client'))).toBe(true)
  })

  it('grants the admin a bundle subscription + app access when the admin exists', async () => {
    // First INSERT (admin) returns the new admin row
    const sql = createSqlStub([[{ id: 1 }]])
    await runSeed(sql as unknown as postgres.Sql, { seedDemo: false })

    expect(sql.calls.some((c) => c.includes("'bundle'"))).toBe(true)
    expect(sql.calls.some((c) => c.includes('INSERT INTO user_app_access'))).toBe(true)
  })

  it('throws when admin env vars are missing', async () => {
    vi.unstubAllEnvs()
    const sql = createSqlStub()
    await expect(runSeed(sql as unknown as postgres.Sql, { seedDemo: false })).rejects.toThrow(
      'Missing required env vars',
    )
  })
})
