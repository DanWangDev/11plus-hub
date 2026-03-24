import { exportJWK, generateKeyPair } from 'jose'
import { createLogger } from '../lib/logger.js'

const logger = createLogger({ service: 'oidc-dev-keys' })

export async function generateDevSigningKey(): Promise<string> {
  logger.warn('generating ephemeral OIDC signing key — set OIDC_SIGNING_KEY in production', {
    operation: 'generateDevSigningKey',
  })

  const { privateKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = await exportJWK(privateKey)
  const keyWithMetadata = {
    ...jwk,
    kid: 'dev-key-1',
    use: 'sig',
    alg: 'RS256',
  }

  return JSON.stringify(keyWithMetadata)
}
