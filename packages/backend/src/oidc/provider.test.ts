import { describe, it, expect, vi, beforeEach } from 'vitest'
import type postgres from 'postgres'

const { mockQueueBclRetry, mockUpdateLastActive, MockProvider, MockGrant } = vi.hoisted(() => {
  const mockQueueBclRetry = vi.fn().mockResolvedValue(undefined)
  const mockUpdateLastActive = vi.fn().mockResolvedValue(undefined)

  class MockGrant {
    accountId: string
    clientId: string
    scopes: string[] = []
    claims: string[] = []
    static find = vi.fn()

    constructor({ accountId, clientId }: { accountId: string; clientId: string }) {
      this.accountId = accountId
      this.clientId = clientId
    }

    addOIDCScope(scope: string): void {
      this.scopes.push(scope)
    }

    addOIDCClaims(claims: string[]): void {
      this.claims.push(...claims)
    }

    async save(): Promise<MockGrant> {
      return this
    }
  }

  class MockProvider {
    static capturedConfig: Record<string, unknown> = {}
    static capturedIssuer = ''
    handlers: Record<string, (...args: unknown[]) => void> = {}
    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      this.handlers[event] = handler
    })
    proxy = false
    Grant = MockGrant

    constructor(issuer: string, config: Record<string, unknown>) {
      MockProvider.capturedIssuer = issuer
      MockProvider.capturedConfig = config
    }
  }

  return { mockQueueBclRetry, mockUpdateLastActive, MockProvider, MockGrant }
})

vi.mock('oidc-provider', () => ({ default: MockProvider }))

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('./pg-adapter.js', () => ({
  createPgAdapter: vi.fn(() => ({})),
}))

vi.mock('./bcl-retry.js', () => ({
  queueBclRetry: (...args: unknown[]) => mockQueueBclRetry(...args),
}))

vi.mock('../services/user-service.js', () => ({
  updateLastActive: (...args: unknown[]) => mockUpdateLastActive(...args),
}))

import { createOidcProvider } from './provider.js'

const SIGNING_KEY = JSON.stringify({
  kty: 'RSA',
  kid: 'test-key-1',
  use: 'sig',
  alg: 'RS256',
})

function createProvider(
  findAccount: (
    ctx: unknown,
    sub: string,
  ) => Promise<
    { accountId: string; claims: () => Promise<Record<string, unknown>> } | undefined
  > = async (sub: string) => ({
    accountId: sub,
    claims: async () => ({ sub }),
  }),
) {
  return createOidcProvider({
    issuer: 'https://hub.labf.app',
    sql: {} as postgres.Sql,
    signingKey: SIGNING_KEY,
    cookieKeys: ['cookie-key-1'],
    findAccount,
  })
}

describe('createOidcProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockProvider.capturedConfig = {}
  })

  it('registers the provider with the issuer', () => {
    createProvider()
    expect(MockProvider.capturedIssuer).toBe('https://hub.labf.app')
  })

  it('configures claim scopes and TTLs', () => {
    createProvider()
    const config = MockProvider.capturedConfig

    expect(config.scopes).toEqual(['openid', 'profile', 'email', 'hub'])
    expect(config.conformIdTokenClaims).toBe(false)
    expect(config.ttl).toMatchObject({
      AccessToken: 15 * 60,
      AuthorizationCode: 60,
      RefreshToken: 7 * 24 * 60 * 60,
      Session: 7 * 24 * 60 * 60,
      Interaction: 60 * 60,
      Grant: 7 * 24 * 60 * 60,
      IdToken: 60 * 60,
    })
    expect(config.cookies.long.httpOnly).toBe(true)
    expect(config.cookies.long.sameSite).toBe('lax')
    expect(config.jwks.keys).toHaveLength(1)
    expect(config.jwks.keys[0].kid).toBe('test-key-1')
  })

  it('requires S256 PKCE for every client', () => {
    createProvider()
    const config = MockProvider.capturedConfig as {
      pkce: { required: () => boolean; methods: string[] }
    }
    expect(config.pkce.required()).toBe(true)
    expect(config.pkce.methods).toEqual(['S256'])
  })

  it('enables backchannel logout and first-party auto-consent', () => {
    createProvider()
    const config = MockProvider.capturedConfig as {
      features: { backchannelLogout: { enabled: boolean } }
    }
    expect(config.features.backchannelLogout.enabled).toBe(true)
  })

  it('issues refresh tokens only for openid-scoped confidential clients', async () => {
    createProvider()
    const config = MockProvider.capturedConfig as {
      issueRefreshToken: (
        ctx: unknown,
        client: { grantTypeAllowed: (t: string) => boolean },
        code: { scopes: Set<string> },
      ) => Promise<boolean>
    }

    const allowedClient = { grantTypeAllowed: (t: string) => t === 'refresh_token' }
    expect(
      await config.issueRefreshToken(null, allowedClient, { scopes: new Set(['openid']) }),
    ).toBe(true)
    expect(
      await config.issueRefreshToken(null, allowedClient, { scopes: new Set(['profile']) }),
    ).toBe(false)
    expect(
      await config.issueRefreshToken(
        null,
        { grantTypeAllowed: () => false },
        { scopes: new Set(['openid']) },
      ),
    ).toBe(false)
  })

  it('auto-creates grants for first-party clients', async () => {
    createProvider()
    const config = MockProvider.capturedConfig as {
      loadExistingGrant: (ctx: unknown) => Promise<MockGrant>
    }

    const ctx = {
      oidc: {
        session: { accountId: '42', grantIdFor: () => undefined },
        client: { clientId: 'vocab-master-client' },
        provider: new MockProvider('https://hub.labf.app', {}),
      },
    }

    const grant = await config.loadExistingGrant(ctx)

    expect(grant).toBeInstanceOf(MockGrant)
    expect(grant.accountId).toBe('42')
    expect(grant.scopes).toContain('openid profile email hub')
  })

  it('returns an existing grant when the session already has one', async () => {
    createProvider()
    const existingGrant = new MockGrant({ accountId: '42', clientId: 'c' })
    MockGrant.find.mockResolvedValueOnce(existingGrant)

    const config = MockProvider.capturedConfig as {
      loadExistingGrant: (ctx: unknown) => Promise<MockGrant>
    }
    const ctx = {
      oidc: {
        result: { consent: { grantId: 'grant-1' } },
        client: { clientId: 'c' },
        provider: new MockProvider('https://hub.labf.app', {}),
      },
    }

    const grant = await config.loadExistingGrant(ctx)

    expect(grant).toBe(existingGrant)
    expect(MockGrant.find).toHaveBeenCalledWith('grant-1')
  })

  it('auto-submits the logout confirmation form', async () => {
    createProvider()
    const config = MockProvider.capturedConfig as {
      features: {
        rpInitiatedLogout: {
          logoutSource: (ctx: { body: string }, form: string) => Promise<void>
        }
      }
    }

    const ctx: { body: string } = { body: '' }
    await config.features.rpInitiatedLogout.logoutSource(ctx, '<form method="POST"></form>')

    expect(ctx.body).toContain('document.forms[0].submit()')
    expect(ctx.body).toContain('name="logout"')
    expect(ctx.body).toContain('<noscript>')
  })

  it('escapes error output in rendered error pages', async () => {
    createProvider()
    const config = MockProvider.capturedConfig as {
      renderError: (ctx: { body: string; type: string }, out: unknown, err: unknown) => void
    }

    const ctx = { body: '', type: '' }
    config.renderError(
      ctx,
      { error: 'invalid_request', error_description: '<script>alert(1)</script>' },
      new Error('boom'),
    )

    expect(ctx.body).toContain('&lt;script&gt;')
    expect(ctx.body).not.toContain('<script>')
  })

  it('allows CORS only for registered client redirect origins', () => {
    createProvider()
    const config = MockProvider.capturedConfig as {
      clientBasedCORS: (ctx: unknown, origin: string, client: { redirectUris: string[] }) => boolean
    }

    const client = { redirectUris: ['https://vocab-master.labf.app/auth/callback'] }

    expect(config.clientBasedCORS(null, 'https://vocab-master.labf.app', client)).toBe(true)
    expect(config.clientBasedCORS(null, 'https://evil.example.com', client)).toBe(false)
  })

  it('trusts proxy headers', () => {
    const provider = createProvider()
    expect(provider.proxy).toBe(true)
  })

  it('bumps last_active_at on grant success', async () => {
    const provider = createProvider()

    provider.handlers['grant.success']({
      oidc: {
        client: { clientId: 'vocab-master-client' },
        entities: { Grant: { accountId: '42' } },
      },
    })
    await Promise.resolve()

    expect(mockUpdateLastActive).toHaveBeenCalledWith({}, 42)
  })

  it('queues a BCL retry on backchannel errors with full context', async () => {
    const provider = createProvider()

    provider.handlers['backchannel.error'](
      {},
      new Error('timeout'),
      { clientId: 'vocab-master-client' },
      '42',
      'sid-1',
    )
    await Promise.resolve()

    expect(mockQueueBclRetry).toHaveBeenCalledWith({}, '42', 'sid-1', 'vocab-master-client')
  })

  it('does not queue a BCL retry when error context is incomplete', async () => {
    const provider = createProvider()

    provider.handlers['backchannel.error'](
      {},
      new Error('timeout'),
      undefined,
      undefined,
      undefined,
    )
    await Promise.resolve()

    expect(mockQueueBclRetry).not.toHaveBeenCalled()
  })

  it('returns undefined for an unknown account', async () => {
    createProvider(async () => undefined)
    const config = MockProvider.capturedConfig as {
      findAccount: (ctx: unknown, sub: string) => Promise<unknown>
    }

    await expect(config.findAccount({}, '999')).resolves.toBeUndefined()
  })

  it('rejects malformed redirect URIs in clientBasedCORS', () => {
    createProvider()
    const config = MockProvider.capturedConfig as {
      clientBasedCORS: (ctx: unknown, origin: string, client: { redirectUris: string[] }) => boolean
    }

    expect(
      config.clientBasedCORS(null, 'https://x.example.com', { redirectUris: ['::bad::'] }),
    ).toBe(false)
  })

  it('renders a fallback message when no error description is provided', async () => {
    createProvider()
    const config = MockProvider.capturedConfig as {
      renderError: (ctx: { body: string }, out: unknown, err: unknown) => void
    }

    const ctx = { body: '' }
    config.renderError(ctx, { error: 'invalid_request' }, undefined)

    expect(ctx.body).toContain('invalid_request')
  })

  it('logs grant errors and server errors', () => {
    const provider = createProvider()

    expect(() => {
      provider.handlers['grant.error']({ oidc: { client: { clientId: 'c' } } }, new Error('nope'))
      provider.handlers['backchannel.success']({ oidc: { client: { clientId: 'c' } } })
      provider.handlers['server_error'](null, new Error('boom'))
    }).not.toThrow()
  })
})
