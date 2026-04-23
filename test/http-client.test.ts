import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  resolveServerUrl,
  resolveBaseUrl,
  executeOperation,
  RequestError,
  ValidationError,
  isJsonContentType,
  isBinaryContentType,
  getMimeType,
} from '../src/http/client.js'
import type { ParsedOperation, ParsedSpec } from 'dynamic-openapi-tools/parser'

function baseOp(overrides: Partial<ParsedOperation> = {}): ParsedOperation {
  return {
    operationId: 'doThing',
    path: '/things',
    method: 'GET',
    tags: [],
    parameters: [],
    responses: {},
    security: [],
    ...overrides,
  }
}

function baseSpec(overrides: Partial<ParsedSpec> = {}): ParsedSpec {
  return {
    title: 'T',
    version: '1.0.0',
    description: undefined,
    servers: [],
    operations: [],
    schemas: {},
    securitySchemes: {},
    tags: [],
    raw: {} as never,
    ...overrides,
  }
}

describe('resolveServerUrl', () => {
  it('substitutes variables with their defaults', () => {
    expect(
      resolveServerUrl({
        url: 'https://{env}.example.com/{version}',
        variables: {
          env: { default: 'api' },
          version: { default: 'v1' },
        },
      })
    ).toBe('https://api.example.com/v1')
  })

  it('accepts variable overrides', () => {
    expect(
      resolveServerUrl(
        { url: 'https://{env}.example.com', variables: { env: { default: 'api' } } },
        { env: 'sandbox' }
      )
    ).toBe('https://sandbox.example.com')
  })

  it('throws when override is not in the enum', () => {
    expect(() =>
      resolveServerUrl(
        {
          url: 'https://{env}.example.com',
          variables: { env: { default: 'api', enum: ['api', 'sandbox'] } },
        },
        { env: 'other' }
      )
    ).toThrow(/Allowed: api, sandbox/)
  })

  it('prefixes missing scheme with https:// and strips trailing slash', () => {
    expect(resolveServerUrl({ url: 'api.example.com/' })).toBe('https://api.example.com')
  })
})

describe('resolveBaseUrl', () => {
  it('returns the override with trailing slash trimmed', () => {
    expect(resolveBaseUrl(baseSpec(), 'https://api.example.com/')).toBe('https://api.example.com')
  })

  it('returns the indexed server URL from the spec', () => {
    const spec = baseSpec({
      servers: [{ url: 'https://a.example.com' }, { url: 'https://b.example.com' }],
    })
    expect(resolveBaseUrl(spec, undefined, 1)).toBe('https://b.example.com')
  })

  it('throws when there is no server and no override', () => {
    expect(() => resolveBaseUrl(baseSpec())).toThrow(/No server URL/)
  })
})

describe('executeOperation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('throws ValidationError when required params or body are missing', async () => {
    const op = baseOp({
      method: 'POST',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object' } } },
      },
    })
    await expect(
      executeOperation(op, {}, { baseUrl: 'https://api.example.com', auth: null })
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('substitutes path params, appends query and array query params, and sets headers', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const op = baseOp({
      path: '/things/{id}',
      method: 'GET',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'q', in: 'query', schema: { type: 'string' } },
        { name: 'tags', in: 'query', schema: { type: 'array' } },
        { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'ok', content: { 'application/json': {} } } },
    })
    await executeOperation(
      op,
      { id: 'abc', q: 'hello', tags: ['a', 'b'], 'X-Trace': '1' },
      { baseUrl: 'https://api.example.com', auth: null, defaultHeaders: { 'X-Default': 'd' } }
    )
    const url = String(spy.mock.calls[0]![0])
    expect(url).toContain('/things/abc')
    expect(url).toContain('q=hello')
    expect(url).toContain('tags=a')
    expect(url).toContain('tags=b')
    const headers = new Headers(spy.mock.calls[0]![1]!.headers)
    expect(headers.get('X-Trace')).toBe('1')
    expect(headers.get('X-Default')).toBe('d')
    expect(headers.get('Accept')).toBe('application/json')
  })

  it('falls back to Accept: application/json when no response media types are declared', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const op = baseOp({ responses: { '204': { description: 'no body' } } })
    await executeOperation(op, {}, { baseUrl: 'https://api.example.com', auth: null })
    const headers = new Headers(spy.mock.calls[0]![1]!.headers)
    expect(headers.get('Accept')).toBe('application/json')
  })

  it('serializes JSON request bodies', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object' } } },
      },
    })
    await executeOperation(
      op,
      { body: { a: 1 } },
      { baseUrl: 'https://api.example.com', auth: null }
    )
    expect(spy.mock.calls[0]![1]!.body).toBe('{"a":1}')
    expect(new Headers(spy.mock.calls[0]![1]!.headers).get('Content-Type')).toBe('application/json')
  })

  it('serializes x-www-form-urlencoded bodies from object input', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
      },
    })
    await executeOperation(
      op,
      { body: { a: 'b', n: 1, f: true, z: null, d: { x: 1 }, u: undefined, arr: [1, 2] } },
      { baseUrl: 'https://api.example.com', auth: null }
    )
    const body = spy.mock.calls[0]![1]!.body as URLSearchParams
    expect(body).toBeInstanceOf(URLSearchParams)
    expect(body.get('a')).toBe('b')
    expect(body.get('n')).toBe('1')
    expect(body.get('f')).toBe('true')
    expect(body.get('z')).toBe('')
    expect(body.get('d')).toBe('{"x":1}')
    expect(body.getAll('arr')).toEqual(['1', '2'])
  })

  it('passes through URLSearchParams and string urlencoded bodies', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
      },
    })
    await executeOperation(
      op,
      { body: new URLSearchParams({ a: 'b' }) },
      { baseUrl: 'https://api.example.com', auth: null }
    )
    expect(spy.mock.calls[0]![1]!.body).toBeInstanceOf(URLSearchParams)

    await executeOperation(
      op,
      { body: 'a=b' },
      { baseUrl: 'https://api.example.com', auth: null }
    )
    expect(spy.mock.calls[1]![1]!.body).toBe('a=b')
  })

  it('rejects urlencoded bodies that are not object, string, or URLSearchParams', async () => {
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
      },
    })
    await expect(
      executeOperation(op, { body: 123 }, { baseUrl: 'https://api.example.com', auth: null })
    ).rejects.toThrow(/x-www-form-urlencoded/)
  })

  it('serializes multipart/form-data from objects, Blobs, ArrayBuffers, and typed arrays', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'multipart/form-data': { schema: { type: 'object' } } },
      },
    })
    const blob = new Blob(['hi'], { type: 'text/plain' })
    const buffer = new ArrayBuffer(4)
    const view = new Uint8Array([1, 2, 3])
    await executeOperation(
      op,
      {
        body: {
          text: 'x',
          num: 1,
          bool: false,
          z: null,
          u: undefined,
          blob,
          buffer,
          view,
          arr: ['a', 'b'],
          obj: { a: 1 },
          bin: { dataBase64: Buffer.from('hello').toString('base64'), filename: 'greet.bin' },
        },
      },
      { baseUrl: 'https://api.example.com', auth: null }
    )
    const body = spy.mock.calls[0]![1]!.body as FormData
    expect(body).toBeInstanceOf(FormData)
    // Content-Type is deleted for FormData so the runtime sets the boundary.
    expect(new Headers(spy.mock.calls[0]![1]!.headers).get('Content-Type')).toBeNull()
  })

  it('passes FormData through untouched for multipart', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'multipart/form-data': { schema: { type: 'object' } } },
      },
    })
    const fd = new FormData()
    fd.set('a', 'b')
    await executeOperation(op, { body: fd }, { baseUrl: 'https://api.example.com', auth: null })
    expect(spy.mock.calls[0]![1]!.body).toBe(fd)
  })

  it('rejects multipart bodies that are not objects or FormData', async () => {
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'multipart/form-data': { schema: { type: 'object' } } },
      },
    })
    await expect(
      executeOperation(op, { body: 42 }, { baseUrl: 'https://api.example.com', auth: null })
    ).rejects.toThrow(/multipart/)
  })

  it('serializes binary bodies from strings, Blobs, ArrayBuffers, typed arrays, and base64 payloads', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'application/octet-stream': { schema: { type: 'string' } } },
      },
    })
    await executeOperation(op, { body: 'raw' }, { baseUrl: 'https://api.example.com', auth: null })
    expect(spy.mock.calls[0]![1]!.body).toBe('raw')

    await executeOperation(
      op,
      { body: new ArrayBuffer(3) },
      { baseUrl: 'https://api.example.com', auth: null }
    )
    expect(spy.mock.calls[1]![1]!.body).toBeInstanceOf(Uint8Array)

    await executeOperation(
      op,
      { body: new Uint8Array([1, 2]) },
      { baseUrl: 'https://api.example.com', auth: null }
    )
    expect(spy.mock.calls[2]![1]!.body).toBeInstanceOf(Uint8Array)

    await executeOperation(
      op,
      {
        body: {
          dataBase64: Buffer.from('hi').toString('base64'),
          filename: 'x.bin',
        },
      },
      { baseUrl: 'https://api.example.com', auth: null }
    )
    expect(Buffer.isBuffer(spy.mock.calls[3]![1]!.body)).toBe(true)
  })

  it('rejects binary bodies that are not a supported shape', async () => {
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'application/octet-stream': { schema: { type: 'string' } } },
      },
    })
    await expect(
      executeOperation(op, { body: 1 }, { baseUrl: 'https://api.example.com', auth: null })
    ).rejects.toThrow(/binary request body/)
  })

  it('handles +json content types as JSON', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'application/vnd.custom+json': { schema: { type: 'object' } } },
      },
    })
    await executeOperation(
      op,
      { body: { a: 1 } },
      { baseUrl: 'https://api.example.com', auth: null }
    )
    expect(new Headers(spy.mock.calls[0]![1]!.headers).get('Content-Type')).toBe(
      'application/vnd.custom+json'
    )
  })

  it('uses string passthrough for exotic text media types', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'application/xml': { schema: { type: 'string' } } },
      },
    })
    await executeOperation(
      op,
      { body: '<a/>' },
      { baseUrl: 'https://api.example.com', auth: null }
    )
    expect(spy.mock.calls[0]![1]!.body).toBe('<a/>')
  })

  it('rejects exotic text media bodies that are not strings', async () => {
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: false,
        content: { 'application/xml': { schema: { type: 'string' } } },
      },
    })
    await expect(
      executeOperation(op, { body: 42 }, { baseUrl: 'https://api.example.com', auth: null })
    ).rejects.toThrow(/must be a string/)
  })

  it('applies auth and retries via refresh when response is 401', async () => {
    const auth = {
      apply: vi.fn(async (_u: URL, init: RequestInit) => ({
        ...init,
        headers: new Headers({ Authorization: 'Bearer stale' }),
      })),
      refresh: vi.fn(async (_u: URL, init: RequestInit) => ({
        ...init,
        headers: new Headers({ Authorization: 'Bearer fresh' }),
      })),
    }
    let count = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      count++
      if (count === 1) return new Response('unauthorized', { status: 401 })
      return new Response('ok', { status: 200 })
    })
    const op = baseOp({ responses: { '200': { description: 'ok' } } })
    const res = await executeOperation(
      op,
      {},
      { baseUrl: 'https://api.example.com', auth }
    )
    expect(res.response.status).toBe(200)
    expect(auth.refresh).toHaveBeenCalled()
  })

  it('wraps auth failures as RequestError', async () => {
    const auth = { apply: vi.fn(async () => { throw new Error('auth broke') }) }
    const op = baseOp()
    await expect(
      executeOperation(op, {}, { baseUrl: 'https://api.example.com', auth })
    ).rejects.toBeInstanceOf(RequestError)
  })

  it('wraps fetch failures as RequestError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network dead'))
    const op = baseOp()
    await expect(
      executeOperation(op, {}, { baseUrl: 'https://api.example.com', auth: null, fetchOptions: { retries: 0 } })
    ).rejects.toBeInstanceOf(RequestError)
  })

  it('wraps refresh failures as RequestError', async () => {
    const auth = {
      apply: vi.fn(async (_u: URL, init: RequestInit) => init),
      refresh: vi.fn(async () => { throw new Error('refresh blew up') }),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('u', { status: 401 }))
    const op = baseOp()
    await expect(
      executeOperation(op, {}, { baseUrl: 'https://api.example.com', auth })
    ).rejects.toBeInstanceOf(RequestError)
  })
})

describe('content type helpers', () => {
  it('detects JSON content types', () => {
    expect(isJsonContentType('application/json')).toBe(true)
    expect(isJsonContentType('application/vnd.api+json; charset=utf-8')).toBe(true)
    expect(isJsonContentType('text/html')).toBe(false)
  })

  it('detects binary content types', () => {
    expect(isBinaryContentType('image/png')).toBe(true)
    expect(isBinaryContentType('application/pdf')).toBe(true)
    expect(isBinaryContentType('application/zip')).toBe(true)
    expect(isBinaryContentType('application/gzip')).toBe(true)
    expect(isBinaryContentType('application/vnd.ms-excel')).toBe(true)
    expect(isBinaryContentType('audio/mp3')).toBe(true)
    expect(isBinaryContentType('video/mp4')).toBe(true)
    expect(isBinaryContentType('text/plain')).toBe(false)
    expect(isBinaryContentType('application/json')).toBe(false)
    expect(isBinaryContentType('application/xml')).toBe(false)
    expect(isBinaryContentType('application/javascript')).toBe(false)
    expect(isBinaryContentType('application/x-www-form-urlencoded')).toBe(false)
    expect(isBinaryContentType('multipart/form-data')).toBe(false)
  })

  it('extracts the mime type from a content type header', () => {
    expect(getMimeType('application/json; charset=utf-8')).toBe('application/json')
    expect(getMimeType('')).toBe('')
  })
})
