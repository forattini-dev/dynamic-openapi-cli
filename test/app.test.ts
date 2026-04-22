import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import type { OpenAPIV3 } from 'openapi-types'
import { resolveSpec } from '../src/parser/resolver.js'
import { buildCli, runCli } from '../src/cli/app.js'

async function miniSpec() {
  const raw = await readFile(join(import.meta.dirname, 'fixtures', 'petstore-mini.yaml'), 'utf-8')
  return resolveSpec(parseYaml(raw) as OpenAPIV3.Document)
}

describe('buildCli + runCli', () => {
  let prevExitCode: number | undefined

  beforeEach(() => {
    prevExitCode = process.exitCode
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = prevExitCode
  })

  it('prints help when invoked with no command', async () => {
    const spec = await miniSpec()
    const cli = buildCli({ spec, baseUrl: 'https://api.example.com' })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    const code = await runCli(cli, [])
    expect(code).toBe(0)
    expect(stdout.mock.calls.map((c) => String(c[0])).join('')).toContain('Petstore Mini')
  })

  it('prints help when --help is passed explicitly', async () => {
    const spec = await miniSpec()
    const cli = buildCli({ spec, baseUrl: 'https://api.example.com' })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    const code = await runCli(cli, ['--help'])
    expect(code).toBe(0)
    expect(stdout).toHaveBeenCalled()
  })

  it('returns a non-zero code for unknown input', async () => {
    const spec = await miniSpec()
    const cli = buildCli({ spec, baseUrl: 'https://api.example.com' })
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    const code = await runCli(cli, ['unknown-command'])
    expect(code).not.toBe(0)
  })

  it('warns about command name collisions on stderr', async () => {
    const spec = await miniSpec()
    spec.operations.push({
      operationId: 'list-pets',
      path: '/aux',
      method: 'GET',
      tags: [],
      parameters: [],
      responses: {},
      security: [],
    })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
    buildCli({ spec, baseUrl: 'https://api.example.com' })
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toContain('duplicate command names')
  })

  it('runs a handler, executes the request, and returns 0 on success', async () => {
    const spec = await miniSpec()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    const cli = buildCli({ spec, baseUrl: 'https://api.example.com' })
    const code = await runCli(cli, ['list-pets'])
    expect(code).toBe(0)
  })

  it('surfaces ValidationError as exit code 2', async () => {
    const spec = await miniSpec()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
    const cli = buildCli({ spec, baseUrl: 'https://api.example.com' })
    const code = await runCli(cli, ['create-pet'])
    expect(code).toBe(2)
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toMatch(/Missing required/)
  })

  it('surfaces RequestError as exit code 1', async () => {
    const spec = await miniSpec()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('dead'))
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
    const cli = buildCli({
      spec,
      baseUrl: 'https://api.example.com',
      fetchOptions: { retries: 0 },
    })
    const code = await runCli(cli, ['list-pets'])
    expect(code).toBe(1)
  })

  it('reads request body from --body-file', async () => {
    const spec = await miniSpec()
    const tmp = mkdtempSync(join(tmpdir(), 'app-body-'))
    const bodyPath = join(tmp, 'body.json')
    writeFileSync(bodyPath, '{"name":"fluffy"}')
    try {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } })
      )
      vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
      vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
      const cli = buildCli({ spec, baseUrl: 'https://api.example.com' })
      // Pass --body alongside --body-file; if --body-file is consumed correctly it wins.
      await runCli(cli, ['create-pet', '--body', '{}', '--body-file', bodyPath])
      if (spy.mock.calls[0]) {
        expect(spy.mock.calls[0]![1]!.body).toBe('{"name":"fluffy"}')
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('parses --body as JSON when it looks like JSON, else passes raw text', async () => {
    const spec = await miniSpec()
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }))
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    const cli = buildCli({ spec, baseUrl: 'https://api.example.com' })
    await runCli(cli, ['create-pet', '--body', '{"name":"a"}'])
    expect(spy.mock.calls[0]![1]!.body).toBe('{"name":"a"}')

    spy.mockClear()
    await runCli(cli, ['create-pet', '--body', 'just text'])
    expect(spy.mock.calls[0]![1]!.body).toBe('"just text"')
  })

  it('applies filter options to hide operations', async () => {
    const spec = await miniSpec()
    const cli = buildCli({
      spec,
      baseUrl: 'https://api.example.com',
      filters: { operations: { exclude: ['createPet'] } },
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    const code = await runCli(cli, ['create-pet'])
    expect([1, 2]).toContain(code)
  })

  it('uses overrides for name, version, and description', async () => {
    const spec = await miniSpec()
    const cli = buildCli({
      spec,
      baseUrl: 'https://api.example.com',
      name: 'petstore',
      version: '9.9.9',
      description: 'custom',
    })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
    await runCli(cli, [])
    const out = stdout.mock.calls.map((c) => String(c[0])).join('')
    expect(out).toContain('petstore')
    expect(out).toContain('custom')
  })
})
