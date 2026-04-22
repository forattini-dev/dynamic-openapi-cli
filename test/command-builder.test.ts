import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { resolveSpec } from '../src/parser/resolver.js'
import { buildCommandsFromSpec } from '../src/cli/command-builder.js'
import type { OpenAPIV3 } from 'openapi-types'

async function loadFixture(name: string) {
  const raw = await readFile(path.join(import.meta.dirname, 'fixtures', name), 'utf-8')
  const doc = parseYaml(raw) as OpenAPIV3.Document
  return resolveSpec(doc)
}

describe('buildCommandsFromSpec', () => {
  it('builds one command per operation with kebab-case names', async () => {
    const spec = await loadFixture('petstore-mini.yaml')
    const { commands, byCommandName, collisions } = buildCommandsFromSpec(spec, {
      handler: async () => {},
    })

    expect(Object.keys(commands).sort()).toEqual(['create-pet', 'get-pet-by-id', 'list-pets'])
    expect(collisions).toEqual([])
    expect(byCommandName.get('list-pets')?.operationId).toBe('listPets')
    expect(byCommandName.get('get-pet-by-id')?.operationId).toBe('getPetById')
  })

  it('maps path params to required positional args in path order', async () => {
    const spec = await loadFixture('petstore-mini.yaml')
    const { commands } = buildCommandsFromSpec(spec, { handler: async () => {} })

    const getById = commands['get-pet-by-id']!
    expect(getById.positional).toEqual([
      expect.objectContaining({ name: 'petId', required: true, type: 'number' }),
    ])
  })

  it('maps query params to options with defaults and choices', async () => {
    const spec = await loadFixture('petstore-mini.yaml')
    const { commands } = buildCommandsFromSpec(spec, { handler: async () => {} })

    const listPets = commands['list-pets']!
    expect(listPets.options?.['limit']).toMatchObject({ type: 'number', default: 20 })
    expect(listPets.options?.['status']).toMatchObject({
      type: 'string',
      choices: ['available', 'pending', 'sold'],
    })
  })

  it('adds --body and --body-file options when operation has requestBody', async () => {
    const spec = await loadFixture('petstore-mini.yaml')
    const { commands } = buildCommandsFromSpec(spec, { handler: async () => {} })

    const createPet = commands['create-pet']!
    expect(createPet.options?.['body']).toMatchObject({ type: 'string', required: true })
    expect(createPet.options?.['body-file']).toMatchObject({ type: 'string' })
  })
})
