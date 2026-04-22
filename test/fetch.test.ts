import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWithRetry } from '../src/utils/fetch.js'

describe('fetchWithRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the response on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const res = await fetchWithRetry('https://example.com')
    expect(res.status).toBe(200)
  })

  it('retries on 5xx and succeeds', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++
      if (calls < 2) return new Response('boom', { status: 503 })
      return new Response('ok', { status: 200 })
    })
    const res = await fetchWithRetry('https://example.com', undefined, { retryDelay: 1 })
    expect(res.status).toBe(200)
    expect(calls).toBe(2)
  })

  it('honors Retry-After header in seconds', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++
      if (calls < 2) return new Response('', { status: 429, headers: { 'Retry-After': '0' } })
      return new Response('ok', { status: 200 })
    })
    const res = await fetchWithRetry('https://example.com', undefined, { retryDelay: 1 })
    expect(res.status).toBe(200)
  })

  it('honors Retry-After header in HTTP-date format', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++
      if (calls < 2) {
        const future = new Date(Date.now() + 1).toUTCString()
        return new Response('', { status: 429, headers: { 'Retry-After': future } })
      }
      return new Response('ok', { status: 200 })
    })
    const res = await fetchWithRetry('https://example.com', undefined, { retryDelay: 1 })
    expect(res.status).toBe(200)
  })

  it('returns the final response after exhausting retries', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }))
    const res = await fetchWithRetry('https://example.com', undefined, { retries: 1, retryDelay: 1 })
    expect(res.status).toBe(503)
  })

  it('retries POST only with retryPolicy: "all"', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++
      if (calls < 2) return new Response('', { status: 503 })
      return new Response('ok', { status: 200 })
    })
    await fetchWithRetry(
      'https://example.com',
      { method: 'POST' },
      { retryPolicy: 'all', retryDelay: 1 }
    )
    expect(calls).toBe(2)
  })

  it('never retries with retryPolicy: "none"', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 503 }))
    await fetchWithRetry('https://example.com', undefined, { retryPolicy: 'none' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('wraps AbortError as a timeout message', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortErr)
    await expect(
      fetchWithRetry('https://example.com', undefined, { retries: 0, timeout: 1, retryDelay: 1 })
    ).rejects.toThrow(/timed out/)
  })

  it('retries on network errors and surfaces the final one', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('enotfound'))
    await expect(
      fetchWithRetry('https://example.com', undefined, { retries: 1, retryDelay: 1 })
    ).rejects.toThrow('enotfound')
  })
})
