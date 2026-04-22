import { readFile } from 'node:fs/promises'
import { createCLI, formatErrors, type CLI, type PrimitiveValue } from 'cli-args-parser'
import type { AuthConfig } from '../auth/types.js'
import { resolveAuth } from '../auth/resolver.js'
import { executeOperation, RequestError, ValidationError, resolveBaseUrl, type HttpClientConfig } from '../http/client.js'
import type { ParsedSpec } from '../parser/types.js'
import type { FetchWithRetryOptions } from '../utils/fetch.js'
import { buildCommandsFromSpec } from './command-builder.js'
import { renderResponse, type OutputOptions } from './output.js'

export interface BuildCliOptions {
  spec: ParsedSpec
  /** Override display name shown in help (default: "dynamic-openapi-cli") */
  name?: string
  /** Override version shown in help (default: spec.version) */
  version?: string
  /** Override top-level description */
  description?: string
  /** Override server base URL */
  baseUrl?: string
  /** Select the Nth server from the spec (default: 0) */
  serverIndex?: number
  /** Programmatic auth config; falls back to env vars otherwise */
  authConfig?: AuthConfig
  /** Tune retry/timeout behavior */
  fetchOptions?: FetchWithRetryOptions
  /** Extra headers attached to every request */
  defaultHeaders?: Record<string, string>
}

const GLOBAL_OPTIONS = {
  output: {
    short: 'o',
    type: 'string' as const,
    description: 'Write response body to file instead of stdout',
  },
  raw: {
    type: 'boolean' as const,
    description: 'Print response body without pretty-printing',
    default: false,
  },
  verbose: {
    short: 'V',
    type: 'boolean' as const,
    description: 'Print HTTP status and headers to stderr',
    default: false,
  },
}

export function buildCli(options: BuildCliOptions): CLI {
  const { spec } = options
  const name = options.name ?? 'dynamic-openapi-cli'
  const version = options.version ?? spec.version
  const description = options.description ?? spec.title

  const baseUrl = resolveBaseUrl(spec, options.baseUrl, options.serverIndex)
  const auth = resolveAuth(options.authConfig, spec.securitySchemes)

  const httpConfig: HttpClientConfig = {
    baseUrl,
    auth,
    defaultHeaders: options.defaultHeaders,
    fetchOptions: options.fetchOptions,
  }

  const { commands, collisions } = buildCommandsFromSpec(spec, {
    handler: async (context, args) => {
      const merged = await mergeArgs(context.operation, args)
      const outputOptions: OutputOptions = {
        outputFile: pickString(args.options['output']),
        raw: Boolean(args.options['raw']),
        verbose: Boolean(args.options['verbose']),
      }

      try {
        const { response } = await executeOperation(context.operation, merged, httpConfig)
        const code = await renderResponse(response, outputOptions)
        if (code !== 0) process.exitCode = code
      } catch (error) {
        if (error instanceof ValidationError) {
          process.stderr.write(`${error.message}\n`)
          process.exitCode = 2
          return
        }
        if (error instanceof RequestError) {
          process.stderr.write(`${error.message}\n`)
          process.exitCode = 1
          return
        }
        const msg = error instanceof Error ? error.message : String(error)
        process.stderr.write(`${msg}\n`)
        process.exitCode = 1
      }
    },
  })

  if (collisions.length > 0) {
    process.stderr.write(
      `warning: duplicate command names collapsed: ${collisions.join(', ')}\n`
    )
  }

  return createCLI({
    name,
    version,
    description,
    autoShort: true,
    options: GLOBAL_OPTIONS,
    commands,
    help: {
      includeGlobalOptionsInCommands: true,
    },
  })
}

/**
 * Parse argv, then either print help, print errors, or run the matched handler.
 * Returns the exit code the caller should use.
 */
export async function runCli(cli: CLI, argv: string[]): Promise<number> {
  const parsed = cli.parse(argv)
  const helpRequested = parsed.options['help'] === true

  if (helpRequested) {
    process.stdout.write(cli.help(parsed.command))
    process.stdout.write('\n')
    return 0
  }

  if (parsed.command.length === 0) {
    process.stdout.write(cli.help())
    process.stdout.write('\n')
    return argv.length === 0 ? 0 : 1
  }

  if (parsed.errors.length > 0) {
    process.stderr.write(formatErrors(parsed.errors, cli.schema.formatter))
    process.stderr.write('\n\n')
    process.stderr.write(cli.help(parsed.command))
    process.stderr.write('\n')
    return 2
  }

  await cli.run(argv)
  const code = process.exitCode
  if (typeof code === 'number') return code
  if (typeof code === 'string') {
    const parsed = Number(code)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

async function mergeArgs(
  operation: import('../parser/types.js').ParsedOperation,
  args: {
    positional: Record<string, PrimitiveValue | PrimitiveValue[]>
    options: Record<string, PrimitiveValue | PrimitiveValue[]>
  }
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(args.positional)) {
    if (value !== undefined) merged[key] = value
  }

  for (const [key, value] of Object.entries(args.options)) {
    if (key === 'output' || key === 'raw' || key === 'verbose' || key === 'body' || key === 'body-file') continue
    if (value !== undefined) merged[key] = value
  }

  if (operation.requestBody) {
    const bodyFile = pickString(args.options['body-file'])
    const bodyRaw = pickString(args.options['body'])
    if (bodyFile) {
      const text = await readFile(bodyFile, 'utf-8')
      merged['body'] = tryParseJson(text)
    } else if (bodyRaw !== undefined) {
      merged['body'] = tryParseJson(bodyRaw)
    }
  }

  return merged
}

function pickString(value: PrimitiveValue | PrimitiveValue[] | undefined): string | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined
  return String(value)
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')
      || /^-?\d/.test(trimmed) || trimmed === 'true' || trimmed === 'false' || trimmed === 'null') {
    try {
      return JSON.parse(trimmed)
    } catch {
      return text
    }
  }
  return text
}
