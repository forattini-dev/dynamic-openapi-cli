import type { CommandDefinition, OptionDefinition, OptionType, PositionalDefinition, PrimitiveValue } from 'cli-args-parser'
import type { OpenAPIV3 } from 'openapi-types'
import type { ParsedOperation, ParsedParameter, ParsedSpec } from '../parser/types.js'
import { sanitizeToolName, truncateDescription } from '../utils/naming.js'

export interface CommandContext {
  operation: ParsedOperation
  commandName: string
}

export interface BuildCommandsResult {
  commands: Record<string, CommandDefinition>
  byCommandName: Map<string, ParsedOperation>
  collisions: string[]
}

export interface BuildCommandsOptions {
  handler: (context: CommandContext, args: {
    positional: Record<string, PrimitiveValue | PrimitiveValue[]>
    options: Record<string, PrimitiveValue | PrimitiveValue[]>
  }) => Promise<void> | void
}

export function buildCommandsFromSpec(
  spec: ParsedSpec,
  options: BuildCommandsOptions
): BuildCommandsResult {
  const commands: Record<string, CommandDefinition> = {}
  const byCommandName = new Map<string, ParsedOperation>()
  const collisions: string[] = []

  for (const operation of spec.operations) {
    const commandName = commandNameFor(operation)

    if (commands[commandName]) {
      collisions.push(commandName)
      continue
    }

    byCommandName.set(commandName, operation)

    commands[commandName] = {
      description: buildDescription(operation),
      positional: buildPositional(operation),
      options: buildOptions(operation),
      handler: async (result) => {
        await options.handler(
          { operation, commandName },
          { positional: result.positional, options: result.options }
        )
      },
    }
  }

  return { commands, byCommandName, collisions }
}

function commandNameFor(operation: ParsedOperation): string {
  const raw = sanitizeToolName(operation.operationId)
  return kebabCase(raw)
}

function buildDescription(operation: ParsedOperation): string {
  const text = operation.summary ?? operation.description ?? `${operation.method} ${operation.path}`
  const prefix = operation.deprecated ? '[deprecated] ' : ''
  return prefix + truncateDescription(text, 160)
}

function buildPositional(operation: ParsedOperation): PositionalDefinition[] {
  const orderedPathParams = orderPathParams(operation)
  return orderedPathParams.map((param) => {
    const type = mapSchemaToOptionType(param.schema)
    const positional: PositionalDefinition = {
      name: param.name,
      required: true,
      type,
    }
    if (param.description) positional.description = truncateDescription(param.description, 120)
    const choices = extractChoices(param.schema)
    if (choices) {
      positional.validate = (value) => {
        const v = Array.isArray(value) ? value : [value]
        for (const item of v) {
          if (!choices.includes(item as PrimitiveValue)) {
            return `must be one of: ${choices.join(', ')}`
          }
        }
        return true
      }
    }
    return positional
  })
}

function orderPathParams(operation: ParsedOperation): ParsedParameter[] {
  const pathParams = operation.parameters.filter((p) => p.in === 'path')
  const order: ParsedParameter[] = []
  const seen = new Set<string>()

  const matches = operation.path.match(/\{([^}]+)\}/g) ?? []
  for (const token of matches) {
    const name = token.slice(1, -1)
    const param = pathParams.find((p) => p.name === name)
    if (param && !seen.has(param.name)) {
      seen.add(param.name)
      order.push(param)
    }
  }

  for (const param of pathParams) {
    if (!seen.has(param.name)) {
      seen.add(param.name)
      order.push(param)
    }
  }

  return order
}

function buildOptions(operation: ParsedOperation): Record<string, OptionDefinition> {
  const options: Record<string, OptionDefinition> = {}

  for (const param of operation.parameters) {
    if (param.in === 'path') continue

    const name = param.name
    if (options[name]) continue

    const type = mapSchemaToOptionType(param.schema)
    const definition: OptionDefinition = {
      type,
    }

    if (param.required) definition.required = true
    if (param.description) {
      const prefix = param.deprecated ? '[deprecated] ' : ''
      definition.description = prefix + truncateDescription(param.description, 120)
    } else if (param.deprecated) {
      definition.description = '[deprecated]'
    }

    const schemaDefault = extractDefault(param.schema)
    if (schemaDefault !== undefined) definition.default = schemaDefault

    const choices = extractChoices(param.schema)
    if (choices) definition.choices = choices

    const alias = kebabCase(name)
    if (alias !== name) {
      definition.aliases = [alias]
    }

    options[name] = definition
  }

  if (operation.requestBody) {
    options['body'] = {
      type: 'string',
      required: operation.requestBody.required,
      description: buildBodyDescription(operation),
    }
    options['body-file'] = {
      type: 'string',
      description: 'Read request body from file (alternative to --body)',
    }
  }

  return options
}

function buildBodyDescription(operation: ParsedOperation): string {
  const contentTypes = Object.keys(operation.requestBody?.content ?? {})
  const base = operation.requestBody?.description ?? 'Request body'
  if (contentTypes.length === 0) return truncateDescription(base, 120)
  return truncateDescription(`${base} (content-types: ${contentTypes.join(', ')})`, 140)
}

function mapSchemaToOptionType(schema: OpenAPIV3.SchemaObject | undefined): OptionType {
  if (!schema) return 'string'
  switch (schema.type) {
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return 'array'
    default:
      return 'string'
  }
}

function extractChoices(schema: OpenAPIV3.SchemaObject | undefined): PrimitiveValue[] | undefined {
  if (!schema) return undefined
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.filter((v) => isPrimitive(v)) as PrimitiveValue[]
  }
  return undefined
}

function extractDefault(schema: OpenAPIV3.SchemaObject | undefined): PrimitiveValue | PrimitiveValue[] | undefined {
  if (!schema) return undefined
  const d = schema.default
  if (d === undefined) return undefined
  if (isPrimitive(d)) return d as PrimitiveValue
  if (Array.isArray(d) && d.every(isPrimitive)) return d as PrimitiveValue[]
  return undefined
}

function isPrimitive(value: unknown): value is PrimitiveValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function kebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}
