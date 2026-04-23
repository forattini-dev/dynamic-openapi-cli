import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenAPIV3 } from 'dynamic-openapi-tools/parser'
import { detectOAuth2AuthCode, createOAuth2AuthCodeAuth } from '../src/auth/resolve.js'
import { generatePkce, generateState } from '../src/auth/pkce.js'
import {
  readTokenCache,
  writeTokenCache,
  deleteTokenCache,
  tokenCachePath,
  tokenCacheDir,
} from '../src/auth/token-cache.js'
import { captureCallback } from '../src/auth/loopback-server.js'
import { OAuth2AuthCodeFlow } from '../src/auth/oauth2-auth-code.js'

describe('generatePkce', () => {
  it('produces a verifier of the expected shape', () => {
    const pair = generatePkce()
    expect(pair.method).toBe('S256')
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generates a different verifier each call', () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier)
  })
})

describe('generateState', () => {
  it('produces a distinct url-safe string', () => {
    expect(generateState()).not.toBe(generateState())
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('token cache', () => {
  let tmp: string
  let prevXdg: string | undefined

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'token-cache-'))
    prevXdg = process.env['XDG_DATA_HOME']
    process.env['XDG_DATA_HOME'] = tmp
  })

  afterEach(() => {
    if (prevXdg === undefined) delete process.env['XDG_DATA_HOME']
    else process.env['XDG_DATA_HOME'] = prevXdg
    rmSync(tmp, { recursive: true, force: true })
  })

  it('derives the cache dir from XDG_DATA_HOME', () => {
    expect(tokenCacheDir()).toBe(join(tmp, 'dynamic-openapi-cli', 'tokens'))
  })

  it('sanitizes cache keys so they cannot escape the tokens dir', async () => {
    const full = tokenCachePath('../../evil/../key')
    const { basename, dirname } = await import('node:path')
    expect(dirname(full)).toBe(tokenCacheDir())
    expect(basename(full).includes('/')).toBe(false)
    expect(basename(full).includes('\\')).toBe(false)
  })

  it('round-trips a token via write/read/delete', async () => {
    await writeTokenCache('k', {
      access_token: 'at',
      refresh_token: 'rt',
      token_type: 'Bearer',
      expires_at: 123,
      scopes: ['a', 'b'],
    })
    const read = await readTokenCache('k')
    expect(read).toEqual({
      access_token: 'at',
      refresh_token: 'rt',
      token_type: 'Bearer',
      expires_at: 123,
      scopes: ['a', 'b'],
    })
    await deleteTokenCache('k')
    expect(await readTokenCache('k')).toBeNull()
  })

  it('returns null for a malformed cache file', async () => {
    await writeTokenCache('broken', {
      access_token: 'at',
      token_type: 'Bearer',
      expires_at: 1,
      scopes: [],
    })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(tokenCachePath('broken'), '{not json}')
    expect(await readTokenCache('broken')).toBeNull()
  })
})

describe('detectOAuth2AuthCode', () => {
  function schemes(): Record<string, OpenAPIV3.SecuritySchemeObject> {
    return {
      myoauth: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://issuer.test/authorize',
            tokenUrl: 'https://issuer.test/token',
            scopes: { 'read:pets': 'Read pets', 'write:pets': 'Write pets' },
          },
        },
      },
    }
  }

  it('returns null when no env clientId is set', () => {
    expect(detectOAuth2AuthCode(schemes(), {})).toBeNull()
  })

  it('picks up the global OPENAPI_OAUTH2_CLIENT_ID', () => {
    const detected = detectOAuth2AuthCode(schemes(), {
      OPENAPI_OAUTH2_CLIENT_ID: 'global-client',
    })
    expect(detected?.schemeName).toBe('myoauth')
    expect(detected?.config.clientId).toBe('global-client')
    expect(detected?.config.authorizationUrl).toBe('https://issuer.test/authorize')
    expect(detected?.config.scopes).toEqual(['read:pets', 'write:pets'])
  })

  it('prefers the per-scheme env over the global one', () => {
    const detected = detectOAuth2AuthCode(schemes(), {
      OPENAPI_OAUTH2_CLIENT_ID: 'global',
      OPENAPI_AUTH_MYOAUTH_CLIENT_ID: 'scoped',
      OPENAPI_AUTH_MYOAUTH_SCOPES: 'read:pets',
      OPENAPI_AUTH_MYOAUTH_PORT: '9999',
    })
    expect(detected?.config.clientId).toBe('scoped')
    expect(detected?.config.scopes).toEqual(['read:pets'])
    expect(detected?.config.redirectPort).toBe(9999)
  })

  it('ignores schemes that do not declare an authorizationCode flow', () => {
    const implicitOnly: Record<string, OpenAPIV3.SecuritySchemeObject> = {
      implicitonly: {
        type: 'oauth2',
        flows: {
          implicit: {
            authorizationUrl: 'https://a.test',
            scopes: {},
          },
        },
      },
    }
    expect(
      detectOAuth2AuthCode(implicitOnly, { OPENAPI_OAUTH2_CLIENT_ID: 'x' })
    ).toBeNull()
  })
})

describe('captureCallback', () => {
  it('resolves with code and state when a matching request arrives', async () => {
    const port = 7000 + Math.floor(Math.random() * 1000)
    const waiter = captureCallback({ port, timeoutMs: 5000 })
    await new Promise((r) => setTimeout(r, 50))
    const res = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=xyz`)
    expect(res.status).toBe(200)
    const callback = await waiter
    expect(callback.code).toBe('abc')
    expect(callback.state).toBe('xyz')
  })

  it('captures error and error_description', async () => {
    const port = 7000 + Math.floor(Math.random() * 1000)
    const waiter = captureCallback({ port, timeoutMs: 5000 })
    await new Promise((r) => setTimeout(r, 50))
    await fetch(`http://127.0.0.1:${port}/callback?error=access_denied&error_description=nope`)
    const callback = await waiter
    expect(callback.error).toBe('access_denied')
    expect(callback.errorDescription).toBe('nope')
  })

  it('rejects on timeout', async () => {
    const port = 7000 + Math.floor(Math.random() * 1000)
    await expect(captureCallback({ port, timeoutMs: 50 })).rejects.toThrow(/timed out/)
  })
})

describe('OAuth2AuthCodeFlow token lifecycle', () => {
  let tmp: string
  let prevXdg: string | undefined

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'oauth2-'))
    prevXdg = process.env['XDG_DATA_HOME']
    process.env['XDG_DATA_HOME'] = tmp
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (prevXdg === undefined) delete process.env['XDG_DATA_HOME']
    else process.env['XDG_DATA_HOME'] = prevXdg
    rmSync(tmp, { recursive: true, force: true })
  })

  it('applies a cached token without hitting the network', async () => {
    const auth = createOAuth2AuthCodeAuth({
      schemeName: 'test',
      clientId: 'c',
      authorizationUrl: 'https://a.test/auth',
      tokenUrl: 'https://a.test/token',
      scopes: ['read'],
    })
    // Seed the cache directly.
    const flow = auth as OAuth2AuthCodeFlow
    // The flow computes its cache key internally; easiest path is to prime it by
    // wiring a stub for fetch and calling apply(), which in turn reads cache.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    // Access the private cacheKey via the flow's logout() round-trip.
    // Simpler: write a valid token whose cache file we derive via a second call.
    // Since deriveCacheKey is stable, invoke forceLogin? No — instead test the
    // "fresh cache" path by pre-populating via writeTokenCache with the same
    // derivation formula. We expose tokenCachePath but not the key; mock instead.
    // Reliable approach: mock readTokenCache by writing through the public
    // writeTokenCache with the exact cache key derivation — replicate it here.
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256')
      .update('c')
      .update('|')
      .update('https://a.test/token')
      .update('|')
      .update(['read'].sort().join(' '))
      .digest('hex')
      .slice(0, 16)
    await writeTokenCache(`test-${hash}`, {
      access_token: 'cached-at',
      token_type: 'Bearer',
      expires_at: Date.now() + 60_000,
      scopes: ['read'],
    })

    const init = await flow.apply(new URL('https://api.test/'), {})
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer cached-at')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refreshes via refresh_token when the cached token is expired', async () => {
    const auth = createOAuth2AuthCodeAuth({
      schemeName: 'test',
      clientId: 'c',
      authorizationUrl: 'https://a.test/auth',
      tokenUrl: 'https://a.test/token',
      scopes: ['read'],
      refreshBufferSeconds: 0,
    })
    const flow = auth as OAuth2AuthCodeFlow
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256')
      .update('c')
      .update('|')
      .update('https://a.test/token')
      .update('|')
      .update('read')
      .digest('hex')
      .slice(0, 16)
    await writeTokenCache(`test-${hash}`, {
      access_token: 'old-at',
      refresh_token: 'rt-1',
      token_type: 'Bearer',
      expires_at: Date.now() - 5_000,
      scopes: ['read'],
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'new-at',
          refresh_token: 'rt-2',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const init = await flow.apply(new URL('https://api.test/'), {})
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer new-at')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = fetchSpy.mock.calls[0]![1]!.body as URLSearchParams
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt-1')
  })
})
