import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBundle } from '../src/cli/bundle.js'

describe('runBundle', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'run-bundle-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('prints help when invoked with no args or --help', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    await runBundle([])
    expect(stdout.mock.calls.map((c) => String(c[0])).join('')).toContain('package an OpenAPI spec')

    stdout.mockClear()
    await runBundle(['-h'])
    expect(stdout).toHaveBeenCalled()

    stdout.mockClear()
    await runBundle(['--help'])
    expect(stdout).toHaveBeenCalled()
  })

  it('exits 2 when required args are missing', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
    await expect(runBundle(['--out', 'x'])).rejects.toThrow('exit:2')
    exit.mockRestore()
  })

  it('writes a shim when given valid args', async () => {
    const out = join(tmp, 'mycli')
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
    await runBundle([
      '--source',
      './test/fixtures/petstore-mini.yaml',
      '--name',
      'mycli',
      '--out',
      out,
    ])
    expect(existsSync(out)).toBe(true)
  })

  it('exits 1 when buildBundle throws', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
    await expect(
      runBundle([
        '--source',
        '/does/not/exist.yaml',
        '--name',
        'x',
        '--out',
        join(tmp, 'out'),
      ])
    ).rejects.toThrow('exit:1')
    exit.mockRestore()
  })
})
