import { describe, it, expect } from 'vitest'
import type { OpenAPIV3 } from 'openapi-types'
import { resolveSpec } from '../src/parser/resolver.js'

function makeDoc(extra: Partial<OpenAPIV3.Document> = {}): OpenAPIV3.Document {
  return {
    openapi: '3.0.0',
    info: { title: 'T', version: '1.0.0' },
    paths: {},
    ...extra,
  } as OpenAPIV3.Document
}

describe('resolveSpec', () => {
  it('rejects invalid specs', async () => {
    const bad = { openapi: '3.0.0' } as OpenAPIV3.Document
    await expect(resolveSpec(bad)).rejects.toThrow(/Invalid OpenAPI spec/)
  })

  it('extracts servers with variables', async () => {
    const doc = makeDoc({
      servers: [
        {
          url: 'https://{env}.example.com',
          description: 'with vars',
          variables: { env: { default: 'api', enum: ['api', 'sandbox'], description: 'env' } },
        },
      ],
    })
    const spec = await resolveSpec(doc)
    expect(spec.servers[0]!.variables?.['env']?.default).toBe('api')
  })

  it('generates operationIds and honors tags', async () => {
    const doc = makeDoc({
      paths: {
        '/pets/{id}': {
          get: {
            responses: { '200': { description: 'ok' } },
            tags: ['pets'],
          },
        },
      },
    })
    const spec = await resolveSpec(doc)
    expect(spec.operations[0]!.operationId).toBe('get_pets_by_id')
    expect(spec.operations[0]!.tags).toEqual(['pets'])
  })

  it('merges path- and operation-level parameters', async () => {
    const doc = makeDoc({
      paths: {
        '/things': {
          parameters: [{ name: 'trace', in: 'header', schema: { type: 'string' } }],
          get: {
            parameters: [
              { name: 'limit', in: 'query', required: true, schema: { type: 'integer' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    })
    const spec = await resolveSpec(doc)
    const names = spec.operations[0]!.parameters.map((p) => p.name)
    expect(names).toEqual(expect.arrayContaining(['trace', 'limit']))
  })

  it('parses request bodies, examples, responses, links', async () => {
    const doc = makeDoc({
      paths: {
        '/things': {
          post: {
            operationId: 'createThing',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { a: { type: 'integer' } } },
                  examples: { sample: { value: { a: 2 } } },
                },
              },
            },
            responses: {
              '201': {
                description: 'created',
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { id: { type: 'integer' } } },
                    examples: { sample: { value: { id: 2 } } },
                  },
                },
                links: { self: { operationId: 'getThing' } },
              },
            },
          },
        },
      },
    })
    const spec = await resolveSpec(doc)
    const op = spec.operations[0]!
    expect(op.requestBody?.content['application/json']?.examples?.['sample']?.value).toEqual({ a: 2 })
    expect(op.responses['201']?.links?.['self']?.operationId).toBe('getThing')
  })

  it('falls back to doc.security when operation has none', async () => {
    const doc = makeDoc({
      security: [{ global: [] }],
      paths: {
        '/a': { get: { responses: { '200': { description: 'ok' } } } },
      },
    })
    const spec = await resolveSpec(doc)
    expect(spec.operations[0]!.security).toEqual([{ global: [] }])
  })

  it('extracts schemas, security schemes, tags, external docs', async () => {
    const doc = makeDoc({
      components: {
        schemas: { Pet: { type: 'object' } },
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      },
      tags: [
        {
          name: 'pets',
          description: 'Pets',
          externalDocs: { url: 'https://example.com', description: 'ext' },
        },
      ],
      externalDocs: { url: 'https://example.com/root' },
    })
    const spec = await resolveSpec(doc)
    expect(spec.schemas['Pet']).toBeDefined()
    expect(spec.securitySchemes['bearer']).toBeDefined()
    expect(spec.tags[0]!.externalDocs).toBeDefined()
    expect(spec.externalDocs?.url).toBe('https://example.com/root')
  })

  it('sets hidden when x-hidden is true', async () => {
    const doc = makeDoc({
      paths: {
        '/a': {
          get: { 'x-hidden': true, responses: { '200': { description: 'ok' } } } as OpenAPIV3.OperationObject,
        },
      },
    }) as OpenAPIV3.Document
    const spec = await resolveSpec(doc)
    expect(spec.operations[0]!.hidden).toBe(true)
  })
})
