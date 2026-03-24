import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { AppError } from '../middleware/error-handler.js'

vi.mock('../db/connection.js', () => ({
  checkDbConnection: vi.fn().mockResolvedValue(true),
  db: {},
}))

const mockCreateApplication = vi.fn()
const mockFindApplicationById = vi.fn()
const mockUpdateApplication = vi.fn()
const mockListApplications = vi.fn()
const mockRotateClientSecret = vi.fn()
const mockCreateServiceToken = vi.fn()
const mockRevokeServiceToken = vi.fn()

vi.mock('../services/app-service.js', () => ({
  createApplication: (...args: unknown[]) => mockCreateApplication(...args),
  findApplicationById: (...args: unknown[]) => mockFindApplicationById(...args),
  updateApplication: (...args: unknown[]) => mockUpdateApplication(...args),
  listApplications: (...args: unknown[]) => mockListApplications(...args),
  rotateClientSecret: (...args: unknown[]) => mockRotateClientSecret(...args),
  createServiceToken: (...args: unknown[]) => mockCreateServiceToken(...args),
  revokeServiceToken: (...args: unknown[]) => mockRevokeServiceToken(...args),
}))

const sampleApp = {
  id: 1,
  name: 'Test App',
  slug: 'test-app',
  url: 'https://test.example.com',
  client_id: 'uuid-123',
  redirect_uris: ['https://test.example.com/callback'],
  icon_url: null,
  stats_api_url: null,
  status: 'active',
  created_at: new Date('2025-01-01T00:00:00Z'),
}

const sampleServiceToken = {
  id: 1,
  app_id: 1,
  token_hash: 'sha256hash',
  scopes: ['read'],
  expires_at: null,
  created_at: new Date('2025-01-01T00:00:00Z'),
}

describe('application routes', () => {
  const app = createApp({ skipDbCheck: true })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/apps', () => {
    it('creates an application (201)', async () => {
      mockCreateApplication.mockResolvedValue({
        application: { ...sampleApp, client_secret_hash: '$2b$12$hash' },
        clientSecret: 'secret-123',
      })

      const res = await request(app)
        .post('/api/apps')
        .send({
          name: 'Test App',
          slug: 'test-app',
          url: 'https://test.example.com',
          redirectUris: ['https://test.example.com/callback'],
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.client_secret).toBe('secret-123')
      expect(res.body.data.client_secret_hash).toBeUndefined()
    })

    it('returns 409 for duplicate slug', async () => {
      const dbError = new Error('duplicate key') as Error & { code: string }
      dbError.code = '23505'
      mockCreateApplication.mockRejectedValue(dbError)

      const res = await request(app)
        .post('/api/apps')
        .send({
          name: 'Test App',
          slug: 'test-app',
          url: 'https://test.example.com',
          redirectUris: ['https://test.example.com/callback'],
        })

      expect(res.status).toBe(409)
      expect(res.body.success).toBe(false)
    })

    it('returns error for invalid data', async () => {
      const { ZodError } = await import('zod')
      mockCreateApplication.mockRejectedValue(
        new ZodError([
          {
            code: 'too_small',
            minimum: 1,
            type: 'string',
            inclusive: true,
            exact: false,
            message: 'String must contain at least 1 character(s)',
            path: ['name'],
          },
        ]),
      )

      const res = await request(app).post('/api/apps').send({ name: '' })

      expect(res.status).toBe(500)
      expect(res.body.success).toBe(false)
    })
  })

  describe('GET /api/apps', () => {
    it('returns paginated list', async () => {
      mockListApplications.mockResolvedValue({
        applications: [{ ...sampleApp, client_secret_hash: '$2b$12$hash' }],
        total: 1,
      })

      const res = await request(app).get('/api/apps')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].client_secret_hash).toBeUndefined()
      expect(res.body.meta).toMatchObject({ total: 1, page: 1, limit: 20 })
    })

    it('respects page and limit query params', async () => {
      mockListApplications.mockResolvedValue({ applications: [], total: 0 })

      const res = await request(app).get('/api/apps?page=2&limit=10')

      expect(res.status).toBe(200)
      expect(res.body.meta).toMatchObject({ page: 2, limit: 10 })
    })
  })

  describe('GET /api/apps/:id', () => {
    it('returns application (200)', async () => {
      mockFindApplicationById.mockResolvedValue({
        ...sampleApp,
        client_secret_hash: '$2b$12$hash',
      })

      const res = await request(app).get('/api/apps/1')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.name).toBe('Test App')
      expect(res.body.data.client_secret_hash).toBeUndefined()
    })

    it('returns 404 when not found', async () => {
      mockFindApplicationById.mockResolvedValue(null)

      const res = await request(app).get('/api/apps/999')

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })

    it('returns 400 for invalid ID', async () => {
      const res = await request(app).get('/api/apps/abc')

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })

  describe('PATCH /api/apps/:id', () => {
    it('updates application', async () => {
      const updatedApp = { ...sampleApp, name: 'Updated App', client_secret_hash: '$2b$12$hash' }
      mockUpdateApplication.mockResolvedValue(updatedApp)

      const res = await request(app).patch('/api/apps/1').send({ name: 'Updated App' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.name).toBe('Updated App')
      expect(res.body.data.client_secret_hash).toBeUndefined()
    })

    it('returns 404 when not found', async () => {
      mockUpdateApplication.mockResolvedValue(null)

      const res = await request(app).patch('/api/apps/999').send({ name: 'Updated App' })

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })
  })

  describe('POST /api/apps/:id/rotate-secret', () => {
    it('returns new secret', async () => {
      mockRotateClientSecret.mockResolvedValue({
        application: { ...sampleApp, client_secret_hash: '$2b$12$newhash' },
        clientSecret: 'new-secret-456',
      })

      const res = await request(app).post('/api/apps/1/rotate-secret')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.client_secret).toBe('new-secret-456')
      expect(res.body.data.client_secret_hash).toBeUndefined()
    })

    it('returns 404 when not found', async () => {
      mockRotateClientSecret.mockResolvedValue(null)

      const res = await request(app).post('/api/apps/999/rotate-secret')

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })
  })

  describe('POST /api/apps/:id/service-tokens', () => {
    it('creates token (201)', async () => {
      mockCreateServiceToken.mockResolvedValue({
        serviceToken: sampleServiceToken,
        token: 'plain-token-789',
      })

      const res = await request(app)
        .post('/api/apps/1/service-tokens')
        .send({ scopes: ['read'] })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.token).toBe('plain-token-789')
    })

    it('returns 404 when application not found', async () => {
      mockCreateServiceToken.mockRejectedValue(new AppError(404, 'Application not found'))

      const res = await request(app).post('/api/apps/999/service-tokens').send({ scopes: [] })

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })
  })

  describe('DELETE /api/apps/:id/service-tokens/:tokenId', () => {
    it('revokes token', async () => {
      mockRevokeServiceToken.mockResolvedValue(true)

      const res = await request(app).delete('/api/apps/1/service-tokens/1')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.revoked).toBe(true)
    })

    it('returns 404 when token not found', async () => {
      mockRevokeServiceToken.mockResolvedValue(false)

      const res = await request(app).delete('/api/apps/1/service-tokens/999')

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })
  })
})
