import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEnv, mockFetch } = vi.hoisted(() => {
  const mockEnv: { RESEND_API_KEY?: string; EMAIL_FROM: string } = {
    RESEND_API_KEY: 're_test_123',
    EMAIL_FROM: '11+ Hub <no-reply@labf.app>',
  }
  return { mockEnv, mockFetch: vi.fn() }
})

vi.mock('../config/env.js', () => ({ env: mockEnv }))

vi.stubGlobal('fetch', mockFetch)

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { isEmailConfigured, sendPasswordResetEmail } from './email-service.js'

describe('email-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.RESEND_API_KEY = 're_test_123'
    mockFetch.mockResolvedValue({ ok: true, text: async () => '' })
  })

  it('reports whether email is configured', () => {
    expect(isEmailConfigured()).toBe(true)
    mockEnv.RESEND_API_KEY = undefined
    expect(isEmailConfigured()).toBe(false)
  })

  it('sends a password reset email via the Resend API', async () => {
    const result = await sendPasswordResetEmail(
      'user@example.com',
      'sel123',
      'val456',
      'https://hub.labf.app/reset-password',
    )

    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test_123',
        }),
      }),
    )
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as { body: string }).body)
    expect(body.to).toEqual(['user@example.com'])
    expect(body.html).toContain(
      'https://hub.labf.app/reset-password?selector=sel123&validator=val456',
    )
  })

  it('returns false without sending when email is not configured', async () => {
    mockEnv.RESEND_API_KEY = undefined

    const result = await sendPasswordResetEmail('u@e.com', 's', 'v', 'https://x')

    expect(result).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns false when Resend rejects the request', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 422, text: async () => 'bad from' })

    const result = await sendPasswordResetEmail('u@e.com', 's', 'v', 'https://x')

    expect(result).toBe(false)
  })

  it('returns false when the network call fails', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))

    const result = await sendPasswordResetEmail('u@e.com', 's', 'v', 'https://x')

    expect(result).toBe(false)
  })
})
