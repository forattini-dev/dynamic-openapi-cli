import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { preScan } from '../src/cli/bootstrap.js'

describe('preScan', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env['OPENAPI_SOURCE']
    delete process.env['OPENAPI_BASE_URL']
    delete process.env['OPENAPI_SERVER_INDEX']
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('extracts bootstrap flags and leaves the rest untouched', () => {
    const result = preScan([
      '-s', './spec.yaml',
      '--base-url', 'http://localhost:3000',
      '--server-index', '2',
      'list-pets',
      '--limit=20',
      '--status', 'available',
    ])

    expect(result.source).toBe('./spec.yaml')
    expect(result.baseUrl).toBe('http://localhost:3000')
    expect(result.serverIndex).toBe(2)
    expect(result.rest).toEqual(['list-pets', '--limit=20', '--status', 'available'])
    expect(result.errors).toEqual([])
  })

  it('supports --flag=value form', () => {
    const result = preScan(['--spec=./spec.yaml', '--name=my-cli', '--app-version=3.0.0'])
    expect(result.source).toBe('./spec.yaml')
    expect(result.name).toBe('my-cli')
    expect(result.appVersion).toBe('3.0.0')
  })

  it('falls back to OPENAPI_SOURCE env when no flag is provided', () => {
    process.env['OPENAPI_SOURCE'] = '/tmp/env-spec.yaml'
    const result = preScan(['list-pets'])
    expect(result.source).toBe('/tmp/env-spec.yaml')
    expect(result.rest).toEqual(['list-pets'])
  })

  it('flags missing values as errors', () => {
    const result = preScan(['--source'])
    expect(result.errors).toEqual(['Missing value for --source'])
  })

  it('rejects non-numeric --server-index', () => {
    const result = preScan(['-s', 'x', '--server-index', 'abc'])
    expect(result.errors).toEqual([
      '--server-index must be a non-negative integer, got "abc"',
    ])
  })

  it('triggers help when no source and --help', () => {
    const result = preScan(['--help'])
    expect(result.help).toBe(true)
    expect(result.source).toBeUndefined()
  })
})
