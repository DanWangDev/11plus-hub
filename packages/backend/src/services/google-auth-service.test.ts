import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockVerifyIdToken } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
}))

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = mockVerifyIdToken
  },
}))

vi.mock('../config/env.js', () => ({
  env: { GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com' },
}))

import { verifyGoogleToken, isGoogleConfigured } from './google-auth-service.js'

describe('google-auth-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verifies an ID token against our audience and returns user info', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: 'g-1',
        email: 'kid@example.com',
        name: 'Kid',
        email_verified: true,
      }),
    })

    const user = await verifyGoogleToken('jwt-token')

    expect(user).toEqual({
      googleId: 'g-1',
      email: 'kid@example.com',
      name: 'Kid',
      emailVerified: true,
    })
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'jwt-token',
      audience: 'test-client-id.apps.googleusercontent.com',
    })
  })

  it('rejects tokens missing sub or email', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ sub: 'g-1' }) })

    await expect(verifyGoogleToken('jwt-token')).rejects.toThrow('missing required fields')
  })

  it('defaults emailVerified to false when the claim is absent', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-1', email: 'kid@example.com' }),
    })

    const user = await verifyGoogleToken('jwt-token')

    expect(user.emailVerified).toBe(false)
  })

  it('derives a name from the email prefix when name is absent', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-1', email: 'kid@example.com', email_verified: true }),
    })

    const user = await verifyGoogleToken('jwt-token')

    expect(user.name).toBe('kid')
  })

  it('reports whether Google auth is configured', () => {
    expect(isGoogleConfigured()).toBe(true)
  })
})
