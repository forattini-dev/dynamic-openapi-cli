import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { preScan } from '../src/cli/bootstrap.js'

describe('preScan — extra coverage', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env['OPENAPI_SOURCE']
    delete process.env['OPENAPI_SOURCE_FILE']
    delete process.env['OPENAPI_BASE_URL']
    delete process.env['OPENAPI_SERVER_INDEX']
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('collects include/exclude filter flags (space-separated form)', () => {
    const res = preScan([
      '-s', 'x',
      '--include-tag', 'pets,store',
      '--exclude-tag', 'admin',
      '--include-operation', 'a, b',
      '--exclude-operation', 'c',
    ])
    expect(res.includeTags).toEqual(['pets', 'store'])
    expect(res.excludeTags).toEqual(['admin'])
    expect(res.includeOperations).toEqual(['a', 'b'])
    expect(res.excludeOperations).toEqual(['c'])
  })

  it('supports every --flag=value form', () => {
    const res = preScan([
      '--source=x',
      '--base-url=https://api',
      '--server-index=3',
      '--name=cli',
      '--app-version=9',
      '--include-tag=t1,t2',
      '--exclude-tag=t3',
      '--include-operation=op1',
      '--exclude-operation=op2',
    ])
    expect(res.source).toBe('x')
    expect(res.baseUrl).toBe('https://api')
    expect(res.serverIndex).toBe(3)
    expect(res.name).toBe('cli')
    expect(res.appVersion).toBe('9')
    expect(res.includeTags).toEqual(['t1', 't2'])
    expect(res.excludeTags).toEqual(['t3'])
    expect(res.includeOperations).toEqual(['op1'])
    expect(res.excludeOperations).toEqual(['op2'])
  })

  it('rejects non-numeric --server-index in =value form', () => {
    const res = preScan(['-s', 'x', '--server-index=nope'])
    expect(res.errors[0]).toContain('non-negative integer')
  })

  it('surfaces missing values for filter flags', () => {
    const res = preScan(['-s', 'x', '--include-tag'])
    expect(res.errors[0]).toBe('Missing value for --include-tag')
  })

  it('surfaces missing values for every bootstrap flag', () => {
    const flags = ['--base-url', '--server-index', '--name', '--app-version']
    for (const flag of flags) {
      const res = preScan(['-s', 'x', flag])
      expect(res.errors).toEqual([`Missing value for ${flag}`])
    }
  })

  it('detects --self-version', () => {
    const res = preScan(['--self-version'])
    expect(res.selfVersion).toBe(true)
  })

  it('reads OPENAPI_BASE_URL and OPENAPI_SERVER_INDEX from env', () => {
    process.env['OPENAPI_BASE_URL'] = 'https://api'
    process.env['OPENAPI_SERVER_INDEX'] = '1'
    const res = preScan(['-s', 'x'])
    expect(res.baseUrl).toBe('https://api')
    expect(res.serverIndex).toBe(1)
  })

  it('reads OPENAPI_SOURCE_FILE as a fallback for source', () => {
    process.env['OPENAPI_SOURCE_FILE'] = '/tmp/spec.yaml'
    const res = preScan([])
    expect(res.source).toBe('/tmp/spec.yaml')
  })

  it('ignores malformed OPENAPI_SERVER_INDEX env', () => {
    process.env['OPENAPI_SERVER_INDEX'] = 'bad'
    const res = preScan(['-s', 'x'])
    expect(res.serverIndex).toBeUndefined()
  })

  it('signals help when no source and first rest token is -h', () => {
    const res = preScan(['-h'])
    expect(res.help).toBe(true)
  })

  it('does not set help when a source is present', () => {
    const res = preScan(['-s', 'x', '--help'])
    expect(res.help).toBeUndefined()
  })

  it('does not set help when a rest command is present without help flag', () => {
    const res = preScan(['list-pets'])
    expect(res.help).toBeUndefined()
  })
})
