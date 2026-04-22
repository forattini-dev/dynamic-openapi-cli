import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BearerAuth,
  ApiKeyAuth,
  BasicAuth,
  OAuth2ClientCredentials,
  TokenExchangeAuth,
  CustomAuth,
  CompositeAuth,
  createAuthFromScheme,
} from '../src/auth/strategies.js'

const BASE_INIT: RequestInit = { method: 'GET' }

async function applyAuth(auth: { apply: (url: URL, init: RequestInit) => Promise<RequestInit> }, urlStr = 'https://example.com/path') {
  const url = new URL(urlStr)
  const init = await auth.apply(url, { ...BASE_INIT })
  return { url, init, headers: new Headers(init.headers) }
}

describe('BearerAuth', () => {
  it('sets the Authorization header', async () => {
    const { headers } = await applyAuth(new BearerAuth('abc'))
    expect(headers.get('Authorization')).toBe('Bearer abc')
  })
})

describe('ApiKeyAuth', () => {
  it('sets a header when location is header', async () => {
    const { headers } = await applyAuth(new ApiKeyAuth('secret', 'X-Api-Key', 'header'))
    expect(headers.get('X-Api-Key')).toBe('secret')
  })

  it('appends a query param when location is query', async () => {
    const { url } = await applyAuth(new ApiKeyAuth('secret', 'api_key', 'query'))
    expect(url.searchParams.get('api_key')).toBe('secret')
  })

  it('encodes a cookie when location is cookie', async () => {
    const { headers } = await applyAuth(new ApiKeyAuth('va lue', 'my name', 'cookie'))
    expect(headers.get('Cookie')).toBe('my%20name=va%20lue')
  })

  it('appends to existing cookie header and replaces duplicate keys', async () => {
    const auth = new ApiKeyAuth('second', 'a', 'cookie')
    const url = new URL('https://example.com')
    const init = await auth.apply(url, { headers: new Headers({ Cookie: 'b=c; a=first' }) })
    const cookie = new Headers(init.headers).get('Cookie') ?? ''
    expect(cookie).toContain('b=c')
    expect(cookie).toContain('a=second')
    expect(cookie).not.toContain('a=first')
  })
})

describe('BasicAuth', () => {
  it('base64-encodes the credentials', async () => {
    const { headers } = await applyAuth(new BasicAuth('user', 'pass'))
    expect(headers.get('Authorization')).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`)
  })
})

describe('OAuth2ClientCredentials', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fetches and caches a token, reusing it on subsequent calls', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const auth = new OAuth2ClientCredentials('id', 'secret', 'https://auth/token', ['read'])
    const url = new URL('https://api/x')
    const init1 = await auth.apply(url, {})
    expect(new Headers(init1.headers).get('Authorization')).toBe('Bearer tok-1')
    await auth.apply(url, {})
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('refresh() invalidates the cache and re-fetches', async () => {
    let count = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      count++
      return new Response(JSON.stringify({ access_token: `t-${count}`, expires_in: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const auth = new OAuth2ClientCredentials('id', 'secret', 'https://auth/token')
    const url = new URL('https://api/x')
    await auth.apply(url, {})
    const init2 = await auth.refresh(url, {})
    expect(new Headers(init2.headers).get('Authorization')).toBe('Bearer t-2')
  })

  it('throws a helpful error when the token response is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    )
    const auth = new OAuth2ClientCredentials('id', 'secret', 'https://auth/token')
    await expect(auth.apply(new URL('https://api/x'), {})).rejects.toThrow(/not valid JSON/)
  })

  it('throws when the token response lacks access_token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ expires_in: 60 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const auth = new OAuth2ClientCredentials('id', 'secret', 'https://auth/token')
    await expect(auth.apply(new URL('https://api/x'), {})).rejects.toThrow(/access_token/)
  })

  it('surfaces the HTTP error body on non-OK responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('bad client', { status: 401, statusText: 'Unauthorized' })
    )
    const auth = new OAuth2ClientCredentials('id', 'secret', 'https://auth/token')
    await expect(auth.apply(new URL('https://api/x'), {})).rejects.toThrow(/OAuth2 token request failed/)
  })

  it('deduplicates concurrent refresh calls via pendingRefresh', async () => {
    let count = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      count++
      await new Promise((r) => setTimeout(r, 5))
      return new Response(JSON.stringify({ access_token: 'dedup', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const auth = new OAuth2ClientCredentials('id', 'secret', 'https://auth/token')
    const url = new URL('https://api/x')
    await Promise.all([auth.apply(url, {}), auth.apply(url, {}), auth.apply(url, {})])
    expect(count).toBe(1)
  })
})

describe('TokenExchangeAuth', () => {
  afterEach(() => vi.restoreAllMocks())

  it('posts JSON fields and sets Authorization with the token type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'xch', token_type: 'custom', expires_in: 10 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const auth = new TokenExchangeAuth({
      tokenUrl: 'https://auth/exchange',
      request: { fields: { client_id: 'id' } },
    })
    const { headers } = await applyAuth(auth)
    expect(headers.get('Authorization')).toBe('Custom xch')
  })

  it('supports form-urlencoded content type on POST', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'x', expires_in: 60 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const auth = new TokenExchangeAuth({
      tokenUrl: 'https://auth/exchange',
      request: {
        method: 'POST',
        contentType: 'application/x-www-form-urlencoded',
        fields: { grant_type: 'client_credentials', cid: 'c' },
      },
    })
    await applyAuth(auth)
    const call = spy.mock.calls[0]!
    expect(String(call[0])).toBe('https://auth/exchange')
    const init = call[1]!
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded')
    expect(init.body).toBeInstanceOf(URLSearchParams)
  })

  it('supports GET by appending fields to the URL', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 't', expires_in: 60 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const auth = new TokenExchangeAuth({
      tokenUrl: 'https://auth/exchange',
      request: { method: 'GET', fields: { a: 'b', n: 1 } },
    })
    await applyAuth(auth)
    expect(String(spy.mock.calls[0]![0])).toContain('a=b')
    expect(String(spy.mock.calls[0]![0])).toContain('n=1')
  })

  it('applies the token as a query parameter when configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'q', expires_in: 60 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const auth = new TokenExchangeAuth({
      tokenUrl: 'https://auth/exchange',
      apply: { location: 'query', name: 'access_token' },
    })
    const { url } = await applyAuth(auth)
    expect(url.searchParams.get('access_token')).toBe('q')
  })

  it('applies the token as a cookie when configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'cookieval', expires_in: 60 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const auth = new TokenExchangeAuth({
      tokenUrl: 'https://auth/exchange',
      apply: { location: 'cookie', name: 'session' },
    })
    const { headers } = await applyAuth(auth)
    expect(headers.get('Cookie')).toContain('session=cookieval')
  })

  it('reads tokens from nested response paths with a custom tokenField', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { auth: { token: 'nested' } }, ttl: 30 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const auth = new TokenExchangeAuth({
      tokenUrl: 'https://auth/exchange',
      response: { tokenField: 'data.auth.token', expiresInField: 'ttl' },
    })
    const { headers } = await applyAuth(auth)
    expect(headers.get('Authorization')).toBe('Bearer nested')
  })

  it('reads expiresAtField for absolute expiry', async () => {
    const future = Date.now() + 60_000
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 't', expires_at: future }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const auth = new TokenExchangeAuth({
      tokenUrl: 'https://auth/exchange',
      response: { expiresAtField: 'expires_at' },
    })
    await applyAuth(auth)
  })

  it('uses defaultExpiresIn when neither expires_in nor expires_at is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 't' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const auth = new TokenExchangeAuth({
      tokenUrl: 'https://auth/exchange',
      defaultExpiresIn: 60,
    })
    await applyAuth(auth)
  })

  it('throws when token response is not JSON or lacks the token field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    )
    const auth = new TokenExchangeAuth({ tokenUrl: 'https://auth/exchange' })
    await expect(applyAuth(auth)).rejects.toThrow(/not valid JSON/)

    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ other: 'field' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const auth2 = new TokenExchangeAuth({ tokenUrl: 'https://auth/exchange' })
    await expect(applyAuth(auth2)).rejects.toThrow(/access_token/)
  })

  it('surfaces HTTP errors from the token endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 502, statusText: 'Bad Gateway' })
    )
    const auth = new TokenExchangeAuth({ tokenUrl: 'https://auth/exchange' })
    await expect(applyAuth(auth)).rejects.toThrow(/Token exchange request failed/)
  })

  it('refresh() re-fetches the token', async () => {
    let c = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      c++
      return new Response(JSON.stringify({ access_token: `x-${c}`, expires_in: 60 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const auth = new TokenExchangeAuth({ tokenUrl: 'https://auth/exchange' })
    await applyAuth(auth)
    const url = new URL('https://api/x')
    const init = await auth.refresh(url, {})
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer x-2')
  })
})

describe('CustomAuth', () => {
  it('delegates to the handler', async () => {
    const handler = vi.fn(async (_u: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      headers.set('X-Custom', '1')
      return { ...init, headers }
    })
    const auth = new CustomAuth(handler)
    const { headers } = await applyAuth(auth)
    expect(headers.get('X-Custom')).toBe('1')
    expect(handler).toHaveBeenCalled()
  })
})

describe('CompositeAuth', () => {
  it('applies strategies in order', async () => {
    const auth = new CompositeAuth([
      new BearerAuth('one'),
      new ApiKeyAuth('key', 'X-Api-Key', 'header'),
    ])
    const { headers } = await applyAuth(auth)
    expect(headers.get('Authorization')).toBe('Bearer one')
    expect(headers.get('X-Api-Key')).toBe('key')
  })

  it('refresh falls back to apply for strategies that do not implement refresh', async () => {
    const refreshed = {
      apply: vi.fn(async (_u: URL, init: RequestInit) => init),
      refresh: vi.fn(async (_u: URL, init: RequestInit) => ({
        ...init,
        headers: new Headers({ 'X-Refreshed': '1' }),
      })),
    }
    const onlyApply = { apply: vi.fn(async (_u: URL, init: RequestInit) => init) }
    const auth = new CompositeAuth([refreshed, onlyApply])
    await auth.refresh(new URL('https://example.com'), {})
    expect(refreshed.refresh).toHaveBeenCalled()
    expect(onlyApply.apply).toHaveBeenCalled()
  })
})

describe('createAuthFromScheme', () => {
  it('builds BearerAuth for http bearer', async () => {
    const auth = createAuthFromScheme({ type: 'http', scheme: 'bearer' } as never, 'tok')!
    expect(auth).toBeInstanceOf(BearerAuth)
  })

  it('builds BasicAuth for http basic, splitting user:pass', async () => {
    const auth = createAuthFromScheme({ type: 'http', scheme: 'basic' } as never, 'u:p')!
    const { headers } = await applyAuth(auth)
    expect(headers.get('Authorization')).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
  })

  it('BasicAuth falls back to empty password when no colon present', async () => {
    const auth = createAuthFromScheme({ type: 'http', scheme: 'basic' } as never, 'onlyuser')!
    const { headers } = await applyAuth(auth)
    expect(headers.get('Authorization')).toBe(`Basic ${Buffer.from('onlyuser:').toString('base64')}`)
  })

  it('returns null for unknown http schemes', () => {
    expect(createAuthFromScheme({ type: 'http', scheme: 'digest' } as never, 'x')).toBeNull()
  })

  it('builds ApiKeyAuth for apiKey schemes', async () => {
    const auth = createAuthFromScheme(
      { type: 'apiKey', in: 'header', name: 'X-Api-Key' } as never,
      'key'
    )!
    expect(auth).toBeInstanceOf(ApiKeyAuth)
  })

  it('falls back to header when apiKey location is invalid', async () => {
    const auth = createAuthFromScheme(
      { type: 'apiKey', in: 'weird', name: 'X-Api-Key' } as never,
      'key'
    )!
    const { headers } = await applyAuth(auth)
    expect(headers.get('X-Api-Key')).toBe('key')
  })

  it('returns null for unsupported scheme types', () => {
    expect(createAuthFromScheme({ type: 'oauth2', flows: {} } as never, 'x')).toBeNull()
  })
})
