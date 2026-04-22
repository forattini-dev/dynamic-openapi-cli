import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, buildFilters } from '../src/cli.js'

const fixture = './test/fixtures/petstore-mini.yaml'

describe('main (cli.ts entry point)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the self-version and returns', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    await main(['node', 'cli', '--self-version'])
    expect(stdout.mock.calls.map((c) => String(c[0])).join('')).toMatch(/dynamic-openapi-cli /)
  })

  it('exits 2 when bootstrap has errors', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
    await expect(main(['node', 'cli', '--source'])).rejects.toThrow('exit:2')
    exit.mockRestore()
  })

  it('prints help and exits when no source and --help', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    await expect(main(['node', 'cli', '--help'])).rejects.toThrow('exit:0')
    expect(stdout.mock.calls.map((c) => String(c[0])).join('')).toContain('dynamic-openapi-cli')
    exit.mockRestore()
  })

  it('prints help and exits 0 when no source and nothing else', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    const prev = process.env['OPENAPI_SOURCE']
    const prevFile = process.env['OPENAPI_SOURCE_FILE']
    delete process.env['OPENAPI_SOURCE']
    delete process.env['OPENAPI_SOURCE_FILE']
    try {
      await expect(main(['node', 'cli'])).rejects.toThrow('exit:0')
    } finally {
      if (prev !== undefined) process.env['OPENAPI_SOURCE'] = prev
      if (prevFile !== undefined) process.env['OPENAPI_SOURCE_FILE'] = prevFile
      exit.mockRestore()
    }
  })

  it('prints help and exits 1 when no source but there is a subcommand', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    const prev = process.env['OPENAPI_SOURCE']
    const prevFile = process.env['OPENAPI_SOURCE_FILE']
    delete process.env['OPENAPI_SOURCE']
    delete process.env['OPENAPI_SOURCE_FILE']
    try {
      await expect(main(['node', 'cli', 'list-pets'])).rejects.toThrow('exit:1')
    } finally {
      if (prev !== undefined) process.env['OPENAPI_SOURCE'] = prev
      if (prevFile !== undefined) process.env['OPENAPI_SOURCE_FILE'] = prevFile
      exit.mockRestore()
    }
  })

  it('runs the built CLI with a spec and lists help on no command', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    await expect(main(['node', 'cli', '-s', fixture])).rejects.toThrow(/exit:\d/)
    exit.mockRestore()
  })

  it('routes bundle subcommand to runBundle', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cli-bundle-'))
    try {
      vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
      await main([
        'node',
        'cli',
        'bundle',
        '--source',
        fixture,
        '--name',
        'mycli',
        '--out',
        join(tmp, 'mycli'),
      ])
      expect(existsSync(join(tmp, 'mycli'))).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('exits 1 when loadSpec throws', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
    await expect(
      main(['node', 'cli', '-s', '/does/not/exist.yaml', 'list-pets'])
    ).rejects.toThrow('exit:1')
    exit.mockRestore()
  })
})

describe('buildFilters (cli.ts)', () => {
  it('returns undefined when no filter flags are set', () => {
    expect(
      buildFilters({
        includeTags: [],
        excludeTags: [],
        includeOperations: [],
        excludeOperations: [],
        rest: [],
        errors: [],
      })
    ).toBeUndefined()
  })

  it('builds tag-only filters when only tag flags are set', () => {
    expect(
      buildFilters({
        includeTags: ['pets'],
        excludeTags: ['admin'],
        includeOperations: [],
        excludeOperations: [],
        rest: [],
        errors: [],
      })
    ).toEqual({ tags: { include: ['pets'], exclude: ['admin'] } })
  })

  it('builds operation-only filters when only operation flags are set', () => {
    expect(
      buildFilters({
        includeTags: [],
        excludeTags: [],
        includeOperations: ['listPets'],
        excludeOperations: ['deletePet'],
        rest: [],
        errors: [],
      })
    ).toEqual({ operations: { include: ['listPets'], exclude: ['deletePet'] } })
  })

  it('combines both', () => {
    expect(
      buildFilters({
        includeTags: ['pets'],
        excludeTags: [],
        includeOperations: ['listPets'],
        excludeOperations: [],
        rest: [],
        errors: [],
      })
    ).toEqual({
      tags: { include: ['pets'] },
      operations: { include: ['listPets'] },
    })
  })
})
