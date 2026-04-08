import { describe, it, expect, vi, beforeEach } from 'vitest'
import { decodeJwt, decodeProtectedHeader } from 'jose'
import { generateDevSigningKey } from './dev-keys.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

type TaggedTemplateArgs = [TemplateStringsArray, ...unknown[]]

function createMockSql(returnValue: unknown[] = []) {
  const sqlFn = vi.fn((..._args: TaggedTemplateArgs) =>
    Promise.resolve(returnValue),
  ) as unknown as Record<string, unknown>
  return Object.assign(sqlFn) as unknown as ReturnType<typeof vi.fn>
}

describe('queueBclRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts a row with correct sub, sid, and client_id', async () => {
    const sql = createMockSql()
    const { queueBclRetry } = await import('./bcl-retry.js')

    await queueBclRetry(sql as never, 'user-123', 'sess-456', 'app-client-id')

    expect(sql).toHaveBeenCalledOnce()
    const args = sql.mock.calls[0] as TaggedTemplateArgs
    const templateParts = args[0].join('?')
    expect(templateParts).toContain('INSERT INTO bcl_retry_queue')
    expect(args[1]).toBe('user-123')
    expect(args[2]).toBe('sess-456')
    expect(args[3]).toBe('app-client-id')
  })

  it('sets next_at approximately 5s in the future', async () => {
    const sql = createMockSql()
    const { queueBclRetry } = await import('./bcl-retry.js')

    const before = Date.now()
    await queueBclRetry(sql as never, 'user-123', 'sess-456', 'app-client-id')
    const after = Date.now()

    const args = sql.mock.calls[0] as TaggedTemplateArgs
    const nextAt = args[4] as Date
    expect(nextAt.getTime()).toBeGreaterThanOrEqual(before + 4000)
    expect(nextAt.getTime()).toBeLessThanOrEqual(after + 6000)
  })
})

describe('generateLogoutToken', () => {
  let signingKey: string

  beforeEach(async () => {
    signingKey = await generateDevSigningKey()
  })

  it('produces a valid JWT with correct claims', async () => {
    const { generateLogoutToken } = await import('./bcl-retry.js')

    const token = await generateLogoutToken(
      'https://hub.example.com',
      signingKey,
      'user-123',
      'sess-456',
      'app-client-id',
    )

    const claims = decodeJwt(token)
    expect(claims.iss).toBe('https://hub.example.com')
    expect(claims.sub).toBe('user-123')
    expect(claims.aud).toBe('app-client-id')
    expect(claims.sid).toBe('sess-456')
    expect(claims.jti).toBeDefined()
    expect(claims.events).toEqual({
      'http://schemas.openid.net/event/backchannel-logout': {},
    })
  })

  it('sets correct protected header', async () => {
    const { generateLogoutToken } = await import('./bcl-retry.js')

    const token = await generateLogoutToken(
      'https://hub.example.com',
      signingKey,
      'user-123',
      'sess-456',
      'app-client-id',
    )

    const header = decodeProtectedHeader(token)
    expect(header.alg).toBe('RS256')
    expect(header.typ).toBe('logout+jwt')
    expect(header.kid).toBe('dev-key-1')
  })

  it('sets expiration to 2 minutes', async () => {
    const { generateLogoutToken } = await import('./bcl-retry.js')

    const token = await generateLogoutToken(
      'https://hub.example.com',
      signingKey,
      'user-123',
      'sess-456',
      'app-client-id',
    )

    const claims = decodeJwt(token)
    expect((claims.exp as number) - (claims.iat as number)).toBe(120)
  })
})

describe('retryPendingBcl', () => {
  let signingKey: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    signingKey = await generateDevSigningKey()
  })

  it('deletes entry on successful 200 response', async () => {
    const pendingEntry = {
      id: 1,
      sub: 'user-123',
      sid: 'sess-456',
      client_id: 'app-client-id',
      attempts: 0,
    }
    const appRow = { backchannel_logout_uri: 'http://localhost:5174/auth/bcl' }

    const callResults = [
      [pendingEntry],
      [appRow],
      [],
    ]
    let callIndex = 0
    const sql = createMockSql()
    sql.mockImplementation(() => Promise.resolve(callResults[callIndex++]))

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    )

    const { retryPendingBcl } = await import('./bcl-retry.js')
    await retryPendingBcl(sql as never, 'https://hub.example.com', signingKey)

    expect(sql).toHaveBeenCalledTimes(3)
    const deleteCall = sql.mock.calls[2] as TaggedTemplateArgs
    expect(deleteCall[0].join('?')).toContain('DELETE FROM bcl_retry_queue')
  })

  it('deletes entry on 204 response', async () => {
    const pendingEntry = {
      id: 1,
      sub: 'user-123',
      sid: 'sess-456',
      client_id: 'app-client-id',
      attempts: 0,
    }
    const appRow = { backchannel_logout_uri: 'http://localhost:5174/auth/bcl' }

    const callResults = [
      [pendingEntry],
      [appRow],
      [],
    ]
    let callIndex = 0
    const sql = createMockSql()
    sql.mockImplementation(() => Promise.resolve(callResults[callIndex++]))

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    )

    const { retryPendingBcl } = await import('./bcl-retry.js')
    await retryPendingBcl(sql as never, 'https://hub.example.com', signingKey)

    expect(sql).toHaveBeenCalledTimes(3)
    const deleteCall = sql.mock.calls[2] as TaggedTemplateArgs
    expect(deleteCall[0].join('?')).toContain('DELETE FROM bcl_retry_queue')
  })

  it('updates attempts and next_at on failure', async () => {
    const pendingEntry = {
      id: 1,
      sub: 'user-123',
      sid: 'sess-456',
      client_id: 'app-client-id',
      attempts: 0,
    }
    const appRow = { backchannel_logout_uri: 'http://localhost:5174/auth/bcl' }

    const callResults = [
      [pendingEntry],
      [appRow],
      [],
    ]
    let callIndex = 0
    const sql = createMockSql()
    sql.mockImplementation(() => Promise.resolve(callResults[callIndex++]))

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { retryPendingBcl } = await import('./bcl-retry.js')
    await retryPendingBcl(sql as never, 'https://hub.example.com', signingKey)

    expect(sql).toHaveBeenCalledTimes(3)
    const updateCall = sql.mock.calls[2] as TaggedTemplateArgs
    const updateSql = updateCall[0].join('?')
    expect(updateSql).toContain('UPDATE bcl_retry_queue')
    expect(updateSql).not.toContain("status = 'failed'")
    expect(updateCall[1]).toBe(1) // attempts = 1
  })

  it('marks as failed after max attempts', async () => {
    const pendingEntry = {
      id: 1,
      sub: 'user-123',
      sid: 'sess-456',
      client_id: 'app-client-id',
      attempts: 4,
    }
    const appRow = { backchannel_logout_uri: 'http://localhost:5174/auth/bcl' }

    const callResults = [
      [pendingEntry],
      [appRow],
      [],
    ]
    let callIndex = 0
    const sql = createMockSql()
    sql.mockImplementation(() => Promise.resolve(callResults[callIndex++]))

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { retryPendingBcl } = await import('./bcl-retry.js')
    await retryPendingBcl(sql as never, 'https://hub.example.com', signingKey)

    expect(sql).toHaveBeenCalledTimes(3)
    const updateCall = sql.mock.calls[2] as TaggedTemplateArgs
    const updateSql = updateCall[0].join('?')
    expect(updateSql).toContain("status = 'failed'")
    expect(updateCall[1]).toBe(5) // attempts = 5
  })

  it('skips and deletes entry when app has no logout URI', async () => {
    const pendingEntry = {
      id: 1,
      sub: 'user-123',
      sid: 'sess-456',
      client_id: 'app-client-id',
      attempts: 0,
    }
    const appRow = { backchannel_logout_uri: null }

    const callResults = [
      [pendingEntry],
      [appRow],
      [],
    ]
    let callIndex = 0
    const sql = createMockSql()
    sql.mockImplementation(() => Promise.resolve(callResults[callIndex++]))

    const { retryPendingBcl } = await import('./bcl-retry.js')
    await retryPendingBcl(sql as never, 'https://hub.example.com', signingKey)

    expect(sql).toHaveBeenCalledTimes(3)
    const deleteCall = sql.mock.calls[2] as TaggedTemplateArgs
    expect(deleteCall[0].join('?')).toContain('DELETE FROM bcl_retry_queue')
  })

  it('skips and deletes entry when app not found', async () => {
    const pendingEntry = {
      id: 1,
      sub: 'user-123',
      sid: 'sess-456',
      client_id: 'app-client-id',
      attempts: 0,
    }

    const callResults = [
      [pendingEntry],
      [],
      [],
    ]
    let callIndex = 0
    const sql = createMockSql()
    sql.mockImplementation(() => Promise.resolve(callResults[callIndex++]))

    const { retryPendingBcl } = await import('./bcl-retry.js')
    await retryPendingBcl(sql as never, 'https://hub.example.com', signingKey)

    expect(sql).toHaveBeenCalledTimes(3)
    const deleteCall = sql.mock.calls[2] as TaggedTemplateArgs
    expect(deleteCall[0].join('?')).toContain('DELETE FROM bcl_retry_queue')
  })
})

describe('startBclRetryJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a timer handle', async () => {
    const sql = createMockSql()
    const { startBclRetryJob } = await import('./bcl-retry.js')

    const handle = startBclRetryJob(sql as never, 'https://hub.example.com', '{}')
    expect(handle).toBeDefined()
    clearInterval(handle)
  })
})
