declare module 'oidc-provider' {
  import type { RequestListener } from 'http'

  interface AdapterPayload {
    [key: string]: unknown
    kind?: string
    grantId?: string
    userCode?: string
    uid?: string
    consumed?: boolean
  }

  interface Adapter {
    upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void>
    find(id: string): Promise<AdapterPayload | undefined>
    findByUserCode(userCode: string): Promise<AdapterPayload | undefined>
    findByUid(uid: string): Promise<AdapterPayload | undefined>
    consume(id: string): Promise<void>
    destroy(id: string): Promise<void>
    revokeByGrantId(grantId: string): Promise<void>
  }

  type AdapterConstructor = (name: string) => Adapter

  interface ClientMetadata {
    client_id: string
    client_secret?: string
    redirect_uris?: string[]
    client_name?: string
    grant_types?: string[]
    response_types?: string[]
    token_endpoint_auth_method?: string
    scope?: string
    post_logout_redirect_uris?: string[]
    [key: string]: unknown
  }

  interface Account {
    accountId: string
    claims: () => Promise<Record<string, unknown>>
  }

  interface OidcSession {
    accountId?: string
    grantIdFor(clientId: string): string | undefined
  }

  interface InteractionDetails {
    uid: string
    prompt: {
      name: string
      details: Record<string, unknown>
    }
    params: Record<string, unknown>
    session?: OidcSession
    grantId?: string
  }

  interface InteractionResult {
    login?: {
      accountId: string
    }
    consent?: Record<string, unknown>
    error?: string
    error_description?: string
  }

  interface GrantInstance {
    addOIDCScope(scope: string): void
    addOIDCClaims(claims: string[]): void
    addResourceScope(indicator: string, scope: string): void
    save(): Promise<string>
  }

  interface ClientInstance {
    clientId: string
    metadata(): ClientMetadata
    grantTypeAllowed(grantType: string): boolean
  }

  interface AuthorizationCode {
    scopes: Set<string>
    [key: string]: unknown
  }

  interface OidcContext {
    oidc: {
      result?: { consent?: { grantId?: string } }
      session?: OidcSession
      client?: ClientInstance
      provider: Provider
    }
  }

  interface Configuration {
    adapter?: AdapterConstructor
    findAccount?: (ctx: unknown, sub: string, token?: unknown) => Promise<Account | undefined>
    claims?: Record<string, string[]>
    scopes?: string[]
    features?: Record<string, { enabled: boolean; [key: string]: unknown }>
    pkce?: {
      methods: string[]
      required: () => boolean
    }
    cookies?: {
      keys: string[]
      long?: Record<string, unknown>
      short?: Record<string, unknown>
    }
    ttl?: Record<string, number>
    jwks?: {
      keys: Record<string, unknown>[]
    }
    interactions?: {
      url: (ctx: unknown, interaction: { uid: string }) => string
    }
    renderError?: (
      ctx: { type: string; body: string },
      out: { error?: string; error_description?: string },
      error: Error,
    ) => Promise<void>
    conformIdTokenClaims?: boolean
    clientBasedCORS?:
      | (() => boolean)
      | ((
          ctx: unknown,
          origin: string,
          client: { redirectUris?: string[]; [key: string]: unknown },
        ) => boolean)
    clients?: ClientMetadata[]
    loadExistingGrant?: (ctx: OidcContext) => Promise<GrantInstance | undefined>
    issueRefreshToken?: (
      ctx: unknown,
      client: ClientInstance,
      code: AuthorizationCode,
    ) => Promise<boolean>
    httpOptions?: (url: unknown) => Record<string, unknown>
    [key: string]: unknown
  }

  class Provider {
    constructor(issuer: string, configuration?: Configuration)
    callback(): RequestListener
    interactionDetails(req: unknown, res: unknown): Promise<InteractionDetails>
    interactionFinished(
      req: unknown,
      res: unknown,
      result: InteractionResult,
      options?: { mergeWithLastSubmission?: boolean },
    ): Promise<void>
    interactionResult(
      req: unknown,
      res: unknown,
      result: InteractionResult | Record<string, unknown>,
      options?: { mergeWithLastSubmission?: boolean },
    ): Promise<string>
    on(event: string, handler: (...args: unknown[]) => void): void

    Client: {
      find(clientId: string): Promise<ClientInstance | undefined>
    }

    Grant: {
      new (options: { accountId: string; clientId: string }): GrantInstance
      find(grantId: string): Promise<GrantInstance | undefined>
    }
  }

  export default Provider
  export type { Adapter, AdapterPayload, ClientMetadata, Account, Configuration }
}
