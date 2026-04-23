import { describe, it, expect } from 'vitest'
import { buildCommandsFromSpec } from '../src/cli/command-builder.js'
import type { ParsedOperation, ParsedSpec } from 'dynamic-openapi-tools/parser'

function baseSpec(operations: ParsedOperation[]): ParsedSpec {
  return {
    title: 'T',
    version: '1',
    servers: [],
    operations,
    schemas: {},
    securitySchemes: {},
    tags: [],
    raw: {} as never,
    description: undefined,
  }
}

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

describe('buildCommandsFromSpec — extra coverage', () => {
  it('collapses duplicate command names into collisions', () => {
    const ops: ParsedOperation[] = [
      baseOp({ operationId: 'listThings', path: '/a' }),
      baseOp({ operationId: 'list-things', path: '/b' }),
    ]
    const { collisions, commands } = buildCommandsFromSpec(baseSpec(ops), { handler: async () => {} })
    expect(collisions).toContain('list-things')
    expect(Object.keys(commands)).toHaveLength(1)
  })

  it('prefixes [deprecated] in the description when operation is deprecated', () => {
    const op = baseOp({ summary: 'Old', deprecated: true })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.description).toMatch(/^\[deprecated\]/)
  })

  it('falls back to METHOD PATH as description when summary/description are absent', () => {
    const op = baseOp({ operationId: 'x', summary: undefined, description: undefined })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['x']!.description).toBe('GET /things')
  })

  it('marks optional parameters as [deprecated] when no description is present', () => {
    const op = baseOp({
      parameters: [
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' }, deprecated: true },
      ],
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.options!['limit']!.description).toBe('[deprecated]')
  })

  it('adds [deprecated] prefix to descriptions of deprecated parameters', () => {
    const op = baseOp({
      parameters: [
        { name: 'limit', in: 'query', required: false, description: 'limit items', schema: { type: 'integer' }, deprecated: true },
      ],
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.options!['limit']!.description).toMatch(/^\[deprecated\] limit items/)
  })

  it('orders path params by their appearance in the path', () => {
    const op = baseOp({
      path: '/a/{second}/b/{first}',
      parameters: [
        { name: 'first', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'second', in: 'path', required: true, schema: { type: 'string' } },
      ],
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.positional!.map((p) => p.name)).toEqual(['second', 'first'])
  })

  it('keeps stray path params that are not in the path template', () => {
    const op = baseOp({
      path: '/a',
      parameters: [
        { name: 'ghost', in: 'path', required: true, schema: { type: 'string' } },
      ],
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.positional!.map((p) => p.name)).toEqual(['ghost'])
  })

  it('attaches a validate() to positional args with enum constraints', () => {
    const op = baseOp({
      path: '/x/{status}',
      parameters: [
        {
          name: 'status',
          in: 'path',
          required: true,
          schema: { type: 'string', enum: ['a', 'b'] },
        },
      ],
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    const validate = commands['do-thing']!.positional![0]!.validate!
    expect(validate('a', [], {})).toBe(true)
    expect(validate('zzz', [], {})).toMatch(/must be one of/)
    expect(validate(['a', 'b'], [], {})).toBe(true)
    expect(validate(['a', 'zzz'], [], {})).toMatch(/must be one of/)
  })

  it('dedupes options when multiple parameters share a name', () => {
    const op = baseOp({
      parameters: [
        { name: 'q', in: 'query', schema: { type: 'string' } },
        { name: 'q', in: 'header', schema: { type: 'string' } },
      ],
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.options!['q']).toBeDefined()
    // second param with same name is ignored
    expect(Object.keys(commands['do-thing']!.options!)).not.toContain('q-2')
  })

  it('adds a kebab-case alias when the original name is camelCase', () => {
    const op = baseOp({
      parameters: [{ name: 'petId', in: 'query', schema: { type: 'string' } }],
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.options!['petId']!.aliases).toEqual(['pet-id'])
  })

  it('extracts primitive and array defaults but drops non-primitive defaults', () => {
    const op = baseOp({
      parameters: [
        { name: 'a', in: 'query', schema: { type: 'string', default: 'x' } },
        { name: 'b', in: 'query', schema: { type: 'array', default: ['x', 'y'] } },
        { name: 'c', in: 'query', schema: { type: 'object', default: { x: 1 } } },
      ],
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.options!['a']!.default).toBe('x')
    expect(commands['do-thing']!.options!['b']!.default).toEqual(['x', 'y'])
    expect(commands['do-thing']!.options!['c']!.default).toBeUndefined()
  })

  it('maps schema types to option types (string, number, boolean, array)', () => {
    const op = baseOp({
      parameters: [
        { name: 's', in: 'query', schema: { type: 'string' } },
        { name: 'i', in: 'query', schema: { type: 'integer' } },
        { name: 'n', in: 'query', schema: { type: 'number' } },
        { name: 'b', in: 'query', schema: { type: 'boolean' } },
        { name: 'a', in: 'query', schema: { type: 'array' } },
        { name: 'e', in: 'query', schema: {} as never },
      ],
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.options!['s']!.type).toBe('string')
    expect(commands['do-thing']!.options!['i']!.type).toBe('number')
    expect(commands['do-thing']!.options!['n']!.type).toBe('number')
    expect(commands['do-thing']!.options!['b']!.type).toBe('boolean')
    expect(commands['do-thing']!.options!['a']!.type).toBe('array')
    expect(commands['do-thing']!.options!['e']!.type).toBe('string')
  })

  it('builds a body description that mentions content types', () => {
    const op = baseOp({
      method: 'POST',
      requestBody: {
        required: true,
        description: 'The thing',
        content: {
          'application/json': { schema: { type: 'object' } },
          'text/plain': { schema: { type: 'string' } },
        },
      },
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.options!['body']!.description).toContain('content-types')
  })

  it('builds a body description when no content types are declared', () => {
    const op = baseOp({
      method: 'POST',
      requestBody: { required: false, content: {} },
    })
    const { commands } = buildCommandsFromSpec(baseSpec([op]), { handler: async () => {} })
    expect(commands['do-thing']!.options!['body']!.description).toBe('Request body')
  })

  it('invokes the provided handler when the command runs', async () => {
    const op = baseOp({ operationId: 'run' })
    let captured: unknown
    const { commands } = buildCommandsFromSpec(baseSpec([op]), {
      handler: async (ctx) => {
        captured = ctx.commandName
      },
    })
    await commands['run']!.handler!({
      command: ['run'],
      positional: {},
      options: {},
      extras: [],
      errors: [],
    } as never)
    expect(captured).toBe('run')
  })
})
