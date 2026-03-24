import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

describe('health routes', () => {
  const app = createApp()

  describe('GET /health', () => {
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

  describe('GET /ready', () => {
    it('returns ready status', async () => {
      const res = await request(app).get('/ready')

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        success: true,
        data: {
          status: 'ready',
          checks: {
            database: 'skipped',
          },
        },
      })
    })
  })

  describe('unknown route', () => {
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
