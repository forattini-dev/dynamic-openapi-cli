import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveAuth } from '../src/auth/resolver.js'
import {
  BearerAuth,
  ApiKeyAuth,
  BasicAuth,
  OAuth2ClientCredentials,
  TokenExchangeAuth,
  CustomAuth,
  CompositeAuth,
} from '../src/auth/strategies.js'

const BEARER_SCHEME = { type: 'http', scheme: 'bearer' } as never
const APIKEY_SCHEME = { type: 'apiKey', in: 'header', name: 'X-Api-Key' } as never

describe('resolveAuth', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env['OPENAPI_AUTH_TOKEN']
    delete process.env['OPENAPI_API_KEY']
    delete process.env['OPENAPI_AUTH_BEARER_TOKEN']
    delete process.env['OPENAPI_AUTH_API_KEY']
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns null when no config and no env vars', () => {
    expect(resolveAuth(undefined, {})).toBeNull()
  })

  it('uses custom handler when provided (takes precedence)', async () => {
    const auth = resolveAuth({ custom: async (_u, init) => init }, {})!
    expect(auth).toBeInstanceOf(CustomAuth)
  })

  it('builds BearerAuth from config.bearerToken', () => {
    const auth = resolveAuth({ bearerToken: 'x' }, {})!
    expect(auth).toBeInstanceOf(BearerAuth)
  })

  it('builds ApiKeyAuth using the spec scheme when available', () => {
    const auth = resolveAuth({ apiKey: 'k' }, { myKey: APIKEY_SCHEME })!
    expect(auth).toBeInstanceOf(ApiKeyAuth)
  })

  it('falls back to default header apiKey location when spec lacks an apiKey scheme', () => {
    const auth = resolveAuth({ apiKey: 'k' }, {})!
    expect(auth).toBeInstanceOf(ApiKeyAuth)
  })

  it('builds BasicAuth from config.basicAuth', () => {
    const auth = resolveAuth({ basicAuth: { username: 'u', password: 'p' } }, {})!
    expect(auth).toBeInstanceOf(BasicAuth)
  })

  it('builds OAuth2ClientCredentials from config.oauth2', () => {
    const auth = resolveAuth(
      { oauth2: { clientId: 'id', clientSecret: 's', tokenUrl: 'https://auth', scopes: ['read'] } },
      {}
    )!
    expect(auth).toBeInstanceOf(OAuth2ClientCredentials)
  })

  it('builds TokenExchangeAuth from config.tokenExchange', () => {
    const auth = resolveAuth({ tokenExchange: { tokenUrl: 'https://auth' } }, {})!
    expect(auth).toBeInstanceOf(TokenExchangeAuth)
  })

  it('combines multiple strategies into CompositeAuth', () => {
    const auth = resolveAuth({ bearerToken: 't', apiKey: 'k' }, { myKey: APIKEY_SCHEME })!
    expect(auth).toBeInstanceOf(CompositeAuth)
  })

  it('reads per-scheme token from env: OPENAPI_AUTH_<NAME>_TOKEN', () => {
    process.env['OPENAPI_AUTH_BEARER_TOKEN'] = 'env-tok'
    const auth = resolveAuth(undefined, { bearer: BEARER_SCHEME })!
    expect(auth).toBeInstanceOf(BearerAuth)
  })

  it('reads per-scheme key from env: OPENAPI_AUTH_<NAME>_KEY', () => {
    process.env['OPENAPI_AUTH_API_KEY'] = 'env-key'
    const auth = resolveAuth(undefined, { apiKey: APIKEY_SCHEME })!
    expect(auth).toBeInstanceOf(ApiKeyAuth)
  })

  it('falls back to OPENAPI_AUTH_TOKEN for any bearer usage', () => {
    process.env['OPENAPI_AUTH_TOKEN'] = 'fallback'
    const auth = resolveAuth(undefined, {})!
    expect(auth).toBeInstanceOf(BearerAuth)
  })

  it('falls back to OPENAPI_API_KEY with spec-declared apiKey scheme', () => {
    process.env['OPENAPI_API_KEY'] = 'fallback-key'
    const auth = resolveAuth(undefined, { myKey: APIKEY_SCHEME })!
    expect(auth).toBeInstanceOf(ApiKeyAuth)
  })

  it('falls back to OPENAPI_API_KEY with default header location', () => {
    process.env['OPENAPI_API_KEY'] = 'fallback-key'
    const auth = resolveAuth(undefined, {})!
    expect(auth).toBeInstanceOf(ApiKeyAuth)
  })

  it('returns null when env lookups produce no usable scheme', () => {
    process.env['OPENAPI_AUTH_SOMETHING_TOKEN'] = 'ignored'
    expect(resolveAuth(undefined, {})).toBeNull()
  })
})
