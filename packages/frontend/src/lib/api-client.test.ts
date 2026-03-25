import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiClient, ApiError } from './api-client'

describe('apiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('makes GET request', async () => {
    const mockResponse = { success: true, data: { id: 1 } }
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    })

    const result = await apiClient.get('/api/test')
    expect(result).toEqual(mockResponse)
    expect(fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ method: 'GET' }))
  })

  it('makes POST request with body', async () => {
    const mockResponse = { success: true }
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    })

    const body = { email: 'test@example.com' }
    await apiClient.post('/api/test', body)

    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
  })

  it('throws ApiError on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ success: false, error: 'Unauthorized' }),
    })

    await expect(apiClient.get('/api/test')).rejects.toThrow(ApiError)

    try {
      await apiClient.get('/api/test')
    } catch {
      // fetch called again above, need separate assertion
    }
  })

  it('ApiError includes status and message', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ success: false, error: 'Not found' }),
    })

    try {
      await apiClient.get('/api/test')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      const apiError = error as ApiError
      expect(apiError.status).toBe(404)
      expect(apiError.message).toBe('Not found')
    }
  })

  it('handles JSON parse failure on error response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Invalid JSON')),
    })

    await expect(apiClient.get('/api/test')).rejects.toThrow(ApiError)
  })

  it('makes PATCH request', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })

    await apiClient.patch('/api/test', { name: 'updated' })
    expect(fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ method: 'PATCH' }))
  })

  it('makes DELETE request', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })

    await apiClient.delete('/api/test')
    expect(fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ method: 'DELETE' }))
  })
})
