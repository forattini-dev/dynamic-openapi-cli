import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderResponse } from '../src/cli/output.js'

function responseWithHeaders(body: BodyInit | null, status: number, headers: Record<string, string>) {
  return new Response(body, { status, headers })
}

describe('renderResponse', () => {
  let stdout: ReturnType<typeof vi.fn>
  let stderr: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdout = vi.fn(() => true)
    stderr = vi.fn(() => true)
    vi.spyOn(process.stdout, 'write').mockImplementation(stdout as never)
    vi.spyOn(process.stderr, 'write').mockImplementation(stderr as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes JSON pretty-printed by default', async () => {
    const res = responseWithHeaders('{"a":1}', 200, { 'Content-Type': 'application/json' })
    const code = await renderResponse(res)
    expect(code).toBe(0)
    expect(stdout.mock.calls.map((c) => String(c[0])).join('')).toContain('"a": 1')
  })

  it('writes raw JSON when --raw is set', async () => {
    const res = responseWithHeaders('{"a":1}', 200, { 'Content-Type': 'application/json' })
    await renderResponse(res, { raw: true })
    expect(stdout.mock.calls.map((c) => String(c[0])).join('')).toContain('{"a":1}')
  })

  it('returns an error code 2 for 4xx responses', async () => {
    const res = responseWithHeaders('{}', 404, { 'Content-Type': 'application/json' })
    expect(await renderResponse(res)).toBe(2)
  })

  it('returns error code 1 for 5xx responses', async () => {
    const res = responseWithHeaders('{}', 500, { 'Content-Type': 'application/json' })
    expect(await renderResponse(res)).toBe(1)
  })

  it('prints verbose headers to stderr', async () => {
    const res = responseWithHeaders('hi', 200, {
      'Content-Type': 'text/plain',
      'X-Request-Id': 'abc',
    })
    await renderResponse(res, { verbose: true })
    const stderrText = stderr.mock.calls.map((c) => String(c[0])).join('')
    expect(stderrText).toContain('200')
    expect(stderrText).toContain('x-request-id: abc')
  })

  it('writes text media types raw', async () => {
    const res = responseWithHeaders('<a/>', 200, { 'Content-Type': 'application/xml' })
    await renderResponse(res)
    expect(stdout.mock.calls.map((c) => String(c[0])).join('')).toContain('<a/>')
  })

  it('appends a newline when text body does not end with one', async () => {
    const res = responseWithHeaders('body', 200, { 'Content-Type': 'text/plain' })
    await renderResponse(res)
    const text = stdout.mock.calls.map((c) => String(c[0])).join('')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('encodes small binary responses as base64 JSON', async () => {
    const res = responseWithHeaders(new Uint8Array([1, 2, 3]), 200, {
      'Content-Type': 'application/octet-stream',
    })
    await renderResponse(res)
    const text = stdout.mock.calls.map((c) => String(c[0])).join('')
    expect(text).toContain('"encoding": "base64"')
    expect(text).toContain('"byteLength": 3')
  })

  it('errors when large binary responses are not routed to a file', async () => {
    const big = new Uint8Array(300 * 1024)
    const res = responseWithHeaders(big, 200, { 'Content-Type': 'application/zip' })
    expect(await renderResponse(res)).toBe(1)
    const stderrText = stderr.mock.calls.map((c) => String(c[0])).join('')
    expect(stderrText).toContain('too large to inline')
  })

  it('falls back to raw when pretty-printing fails', async () => {
    const res = responseWithHeaders('not json', 200, { 'Content-Type': 'application/json' })
    await renderResponse(res)
    // prettyJson returns text unchanged when JSON.parse fails
    expect(stdout.mock.calls.map((c) => String(c[0])).join('')).toContain('not json')
  })

  it('writes response body to file when outputFile is set', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cli-output-'))
    try {
      const path = join(tmp, 'out.bin')
      const res = responseWithHeaders('hello', 200, { 'Content-Type': 'application/octet-stream' })
      const code = await renderResponse(res, { outputFile: path })
      expect(code).toBe(0)
      expect(readFileSync(path, 'utf-8')).toBe('hello')
      const stderrText = stderr.mock.calls.map((c) => String(c[0])).join('')
      expect(stderrText).toContain('wrote 5 bytes')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
