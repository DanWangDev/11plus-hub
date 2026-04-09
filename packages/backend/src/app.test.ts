import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from './app.js'

describe('createApp', () => {
  const app = createApp({ skipDbCheck: true })

  it('returns an express application', () => {
    expect(app).toBeDefined()
    expect(typeof app.listen).toBe('function')
  })

  it('sets security headers via helmet', async () => {
    const res = await request(app).get('/api/health')

    expect(res.headers).toHaveProperty('x-content-type-options', 'nosniff')
    expect(res.headers).toHaveProperty('x-frame-options')
  })

  it('sets x-request-id header', async () => {
    const res = await request(app).get('/api/health')

    expect(res.headers).toHaveProperty('x-request-id')
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('forwards existing x-request-id', async () => {
    const res = await request(app).get('/api/health').set('x-request-id', 'test-id-123')

    expect(res.headers['x-request-id']).toBe('test-id-123')
  })

  it('parses JSON body', async () => {
    const res = await request(app)
      .post('/nonexistent')
      .send({ test: true })
      .set('Content-Type', 'application/json')

    // Should reach 404 handler, not crash on body parsing
    expect(res.status).toBe(404)
  })

  it('enables CORS', async () => {
    const res = await request(app).options('/api/health').set('Origin', 'http://localhost:5173')

    expect(res.headers).toHaveProperty('access-control-allow-origin')
  })
})
