import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../services/app-service.js', () => ({
  verifyServiceToken: vi.fn(),
}))

vi.mock('../services/subscription-service.js', () => ({
  checkEntitlement: vi.fn(),
}))

import { verifyServiceToken } from '../services/app-service.js'
import { checkEntitlement } from '../services/subscription-service.js'

const mockVerifyServiceToken = vi.mocked(verifyServiceToken)
const mockCheckEntitlement = vi.mocked(checkEntitlement)

function createMockSql() {
  const sqlFn = vi.fn(() => Promise.resolve([])) as unknown as Record<string, unknown>
  return sqlFn
}

function createTestApp() {
  const sql = createMockSql()
  return createApp({ skipDbCheck: true, sql: sql as never })
}

describe('GET /api/entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without Authorization header', async () => {
    const app = createTestApp()
    const res = await request(app).get('/api/entitlement?user_id=42')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Missing service token')
  })

  it('returns 401 with invalid token', async () => {
    mockVerifyServiceToken.mockResolvedValueOnce(null)

    const app = createTestApp()
    const res = await request(app)
      .get('/api/entitlement?user_id=42')
      .set('Authorization', 'Bearer invalid-token')

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid or expired service token')
  })

  it('returns 400 without user_id', async () => {
    const sql = createMockSql()
    ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ slug: 'writing' }])
    mockVerifyServiceToken.mockResolvedValueOnce({
      id: 1,
      app_id: 10,
      token_hash: 'hash',
      scopes: [],
      created_at: new Date().toISOString(),
      expires_at: null,
    } as never)

    const app = createApp({ skipDbCheck: true, sql: sql as never })
    const res = await request(app)
      .get('/api/entitlement')
      .set('Authorization', 'Bearer valid-token')

    expect(res.status).toBe(400)
  })

  it('returns entitled: true when user has access', async () => {
    const sql = createMockSql()
    ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ slug: 'writing' }])
    mockVerifyServiceToken.mockResolvedValueOnce({
      id: 1,
      app_id: 10,
      token_hash: 'hash',
      scopes: [],
      created_at: new Date().toISOString(),
      expires_at: null,
    } as never)
    mockCheckEntitlement.mockResolvedValueOnce(true)

    const app = createApp({ skipDbCheck: true, sql: sql as never })
    const res = await request(app)
      .get('/api/entitlement?user_id=42')
      .set('Authorization', 'Bearer valid-token')

    expect(res.status).toBe(200)
    expect(res.body.data.entitled).toBe(true)
    expect(res.body.data.app_slug).toBe('writing')
    expect(res.body.data.user_id).toBe(42)
  })

  it('returns entitled: false when user lacks access', async () => {
    const sql = createMockSql()
    ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ slug: 'writing' }])
    mockVerifyServiceToken.mockResolvedValueOnce({
      id: 1,
      app_id: 10,
      token_hash: 'hash',
      scopes: [],
      created_at: new Date().toISOString(),
      expires_at: null,
    } as never)
    mockCheckEntitlement.mockResolvedValueOnce(false)

    const app = createApp({ skipDbCheck: true, sql: sql as never })
    const res = await request(app)
      .get('/api/entitlement?user_id=42')
      .set('Authorization', 'Bearer valid-token')

    expect(res.status).toBe(200)
    expect(res.body.data.entitled).toBe(false)
  })
})
