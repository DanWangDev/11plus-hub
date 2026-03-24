import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

vi.mock('../db/connection.js', () => ({
  checkDbConnection: vi.fn().mockResolvedValue(true),
  db: {},
}))

describe('health routes', () => {
  describe('GET /health', () => {
    const app = createApp({ skipDbCheck: true })

    it('returns healthy status', async () => {
      const res = await request(app).get('/health')

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        success: true,
        data: {
          status: 'healthy',
          uptime: expect.any(Number),
        },
      })
    })

    it('includes version', async () => {
      const res = await request(app).get('/health')
      expect(res.body.data).toHaveProperty('version')
    })
  })

  describe('GET /ready (skipDbCheck)', () => {
    const app = createApp({ skipDbCheck: true })

    it('returns ready with database skipped', async () => {
      const res = await request(app).get('/ready')

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        success: true,
        data: {
          status: 'ready',
          checks: { database: 'skipped' },
        },
      })
    })
  })

  describe('GET /ready (with DB check)', () => {
    it('returns ready when DB is connected', async () => {
      const { checkDbConnection } = await import('../db/connection.js')
      vi.mocked(checkDbConnection).mockResolvedValue(true)

      const app = createApp()
      const res = await request(app).get('/ready')

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        success: true,
        data: {
          status: 'ready',
          checks: { database: 'ok' },
        },
      })
    })

    it('returns 503 when DB is down', async () => {
      const { checkDbConnection } = await import('../db/connection.js')
      vi.mocked(checkDbConnection).mockResolvedValue(false)

      const app = createApp()
      const res = await request(app).get('/ready')

      expect(res.status).toBe(503)
      expect(res.body).toMatchObject({
        success: false,
        data: {
          status: 'not_ready',
          checks: { database: 'fail' },
        },
      })
    })
  })

  describe('unknown route', () => {
    const app = createApp({ skipDbCheck: true })

    it('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/nonexistent')

      expect(res.status).toBe(404)
      expect(res.body).toEqual({
        success: false,
        error: 'Not found',
      })
    })
  })
})
