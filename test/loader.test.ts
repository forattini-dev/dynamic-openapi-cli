import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveSource, loadSpec } from '../src/parser/loader.js'

describe('resolveSource', () => {
  it('detects HTTP URLs', () => {
    expect(resolveSource('http://api.example.com/spec.json').type).toBe('url')
    expect(resolveSource('https://api.example.com/spec.json').type).toBe('url')
  })

  it('detects inline JSON and YAML strings', () => {
    expect(resolveSource('{"openapi":"3.0.0"}').type).toBe('inline')
    expect(resolveSource('openapi: 3.0.0').type).toBe('inline')
  })

  it('falls back to file type for paths', () => {
    expect(resolveSource('./spec.yaml')).toEqual({ type: 'file', value: './spec.yaml' })
  })

  it('treats Document objects as inline', () => {
    const doc = { openapi: '3.0.0' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveSource(doc as any).type).toBe('inline')
  })
})

describe('loadSpec', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads YAML from disk', async () => {
    const doc = await loadSpec('./test/fixtures/petstore-mini.yaml')
    expect(doc.info.title).toBe('Petstore Mini')
  })

  it('parses inline JSON', async () => {
    const raw = JSON.stringify({ openapi: '3.0.0', info: { title: 'J', version: '1' }, paths: {} })
    const doc = await loadSpec(raw)
    expect(doc.info.title).toBe('J')
  })

  it('parses inline YAML', async () => {
    const doc = await loadSpec('openapi: 3.0.0\ninfo:\n  title: Y\n  version: "1"\npaths: {}\n')
    expect(doc.info.title).toBe('Y')
  })

  it('returns inline Document objects unchanged', async () => {
    const doc = { openapi: '3.0.0', info: { title: 'Z', version: '1' }, paths: {} }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await loadSpec(doc as any)).toBe(doc)
  })

  it('reports file-read errors with the path', async () => {
    await expect(loadSpec('/does/not/exist.yaml')).rejects.toThrow(/Failed to read spec file/)
  })

  it('reports JSON parse errors', async () => {
    await expect(loadSpec('{ not: valid')).rejects.toThrow(/Failed to parse JSON/)
  })

  it('fetches remote specs', async () => {
    const body = 'openapi: 3.0.0\ninfo:\n  title: Remote\n  version: "1"\npaths: {}\n'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
    const doc = await loadSpec('https://example.com/spec.yaml')
    expect(doc.info.title).toBe('Remote')
  })

  it('throws on non-OK remote responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404, statusText: 'Not Found' }))
    )
    await expect(loadSpec('https://example.com/missing.yaml')).rejects.toThrow(/Failed to fetch spec/)
  })
})
