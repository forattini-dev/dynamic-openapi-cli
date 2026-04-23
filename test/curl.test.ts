import { describe, it, expect } from 'vitest'
import type { ParsedOperation } from 'dynamic-openapi-tools/parser'
import { renderCurl, shellQuote } from '../src/cli/curl.js'
import type { PreparedRequest } from '../src/http/client.js'

const op: ParsedOperation = {
  operationId: 'doThing',
  path: '/things',
  method: 'GET',
  tags: [],
  parameters: [],
  responses: {},
  security: [],
}

function prepared(overrides: Partial<PreparedRequest>): PreparedRequest {
  return {
    url: new URL('https://api.example.com/things'),
    method: 'GET',
    headers: new Headers({ Accept: 'application/json' }),
    body: undefined,
    bodyInfo: { kind: 'none' },
    operation: op,
    ...overrides,
  }
}

describe('shellQuote', () => {
  it('wraps a plain string in single quotes', () => {
    expect(shellQuote('hello')).toBe(`'hello'`)
  })

  it('escapes embedded single quotes', () => {
    expect(shellQuote(`a'b`)).toBe(`'a'\\''b'`)
  })
})

describe('renderCurl', () => {
  it('renders a GET with headers and no body', () => {
    const out = renderCurl(
      prepared({
        headers: new Headers({ accept: 'application/json', 'x-trace': '1' }),
      })
    )
    expect(out).toContain(`curl -X GET 'https://api.example.com/things'`)
    expect(out).toContain(`-H 'accept: application/json'`)
    expect(out).toContain(`-H 'x-trace: 1'`)
    expect(out).not.toContain('--data')
  })

  it('renders a JSON body with --data', () => {
    const out = renderCurl(
      prepared({
        method: 'POST',
        bodyInfo: {
          kind: 'json',
          value: { name: 'rex' },
          contentType: 'application/json',
        },
      })
    )
    expect(out).toContain(`--data '{"name":"rex"}'`)
  })

  it('renders urlencoded bodies as --data-urlencode pairs', () => {
    const out = renderCurl(
      prepared({
        method: 'POST',
        bodyInfo: {
          kind: 'urlencoded',
          pairs: [
            ['a', 'b'],
            ['tags', 'x'],
            ['tags', 'y'],
          ],
          contentType: 'application/x-www-form-urlencoded',
        },
      })
    )
    expect(out).toContain(`--data-urlencode 'a=b'`)
    expect(out).toContain(`--data-urlencode 'tags=x'`)
    expect(out).toContain(`--data-urlencode 'tags=y'`)
  })

  it('renders multipart file entries with @path and plain values without', () => {
    const out = renderCurl(
      prepared({
        method: 'POST',
        bodyInfo: {
          kind: 'multipart',
          contentType: 'multipart/form-data',
          fields: [
            { name: 'file', kind: 'file', path: '/tmp/a.txt', filename: 'a.txt', contentType: 'application/octet-stream', bytes: 10 },
            { name: 'note', kind: 'value', value: 'hello' },
          ],
        },
      })
    )
    expect(out).toContain(`-F 'file=@/tmp/a.txt'`)
    expect(out).toContain(`-F 'note=hello'`)
  })

  it('renders binary bodies with --data-binary @file when a file path is known', () => {
    const out = renderCurl(
      prepared({
        method: 'PUT',
        bodyInfo: {
          kind: 'binary',
          contentType: 'application/octet-stream',
          filePath: '/tmp/payload.bin',
          bytes: 100,
        },
      })
    )
    expect(out).toContain(`--data-binary '@/tmp/payload.bin'`)
  })

  it('renders inline binary as @- with a byte count hint', () => {
    const out = renderCurl(
      prepared({
        method: 'PUT',
        bodyInfo: { kind: 'binary', contentType: 'application/octet-stream', bytes: 42 },
      })
    )
    expect(out).toContain(`--data-binary @-`)
    expect(out).toContain('42 bytes')
  })

  it('renders text bodies as --data with quoted content', () => {
    const out = renderCurl(
      prepared({
        method: 'POST',
        bodyInfo: { kind: 'text', value: 'hello world', contentType: 'text/plain' },
      })
    )
    expect(out).toContain(`--data 'hello world'`)
  })
})
