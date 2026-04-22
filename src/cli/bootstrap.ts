export interface BootstrapArgs {
  /** OpenAPI spec source: URL, file path, or inline JSON/YAML */
  source?: string
  /** Override the server base URL */
  baseUrl?: string
  /** Select the Nth server from the spec (0-based) */
  serverIndex?: number
  /** Display name for the dynamic CLI (used by bundled shims) */
  name?: string
  /** Display version for the dynamic CLI (used by bundled shims) */
  appVersion?: string
  /** Print dynamic-openapi-cli's own version and exit */
  selfVersion?: boolean
  /** Show top-level help when no source is provided */
  help?: boolean
  /** --include-tag entries (repeatable / comma-separated) */
  includeTags: string[]
  /** --exclude-tag entries (repeatable / comma-separated) */
  excludeTags: string[]
  /** --include-operation entries (repeatable / comma-separated) */
  includeOperations: string[]
  /** --exclude-operation entries (repeatable / comma-separated) */
  excludeOperations: string[]
  /** Remaining argv to hand off to the dynamic CLI */
  rest: string[]
  /** Errors collected during pre-scan */
  errors: string[]
}

const SOURCE_FLAGS = new Set(['-s', '--source', '--spec'])
const BASE_URL_FLAGS = new Set(['-b', '--base-url'])
const SERVER_INDEX_FLAGS = new Set(['--server-index'])
const NAME_FLAGS = new Set(['--name'])
const APP_VERSION_FLAGS = new Set(['--app-version'])
const SELF_VERSION_FLAGS = new Set(['--self-version'])
const INCLUDE_TAG_FLAGS = new Set(['--include-tag'])
const EXCLUDE_TAG_FLAGS = new Set(['--exclude-tag'])
const INCLUDE_OPERATION_FLAGS = new Set(['--include-operation'])
const EXCLUDE_OPERATION_FLAGS = new Set(['--exclude-operation'])

const LONG_VALUE_PREFIXES = [
  '--source=',
  '--spec=',
  '--base-url=',
  '--server-index=',
  '--name=',
  '--app-version=',
  '--include-tag=',
  '--exclude-tag=',
  '--include-operation=',
  '--exclude-operation=',
]

function pushCsv(target: string[], value: string): void {
  for (const piece of value.split(',')) {
    const trimmed = piece.trim()
    if (trimmed) target.push(trimmed)
  }
}

export function preScan(argv: string[]): BootstrapArgs {
  const args: BootstrapArgs = {
    rest: [],
    errors: [],
    includeTags: [],
    excludeTags: [],
    includeOperations: [],
    excludeOperations: [],
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!

    if (SOURCE_FLAGS.has(token)) {
      const value = argv[++i]
      if (value === undefined) {
        args.errors.push(`Missing value for ${token}`)
        continue
      }
      args.source = value
      continue
    }

    if (BASE_URL_FLAGS.has(token)) {
      const value = argv[++i]
      if (value === undefined) {
        args.errors.push(`Missing value for ${token}`)
        continue
      }
      args.baseUrl = value
      continue
    }

    if (SERVER_INDEX_FLAGS.has(token)) {
      const value = argv[++i]
      if (value === undefined) {
        args.errors.push(`Missing value for ${token}`)
        continue
      }
      const parsed = Number.parseInt(value, 10)
      if (Number.isNaN(parsed) || parsed < 0) {
        args.errors.push(`--server-index must be a non-negative integer, got "${value}"`)
        continue
      }
      args.serverIndex = parsed
      continue
    }

    if (NAME_FLAGS.has(token)) {
      const value = argv[++i]
      if (value === undefined) {
        args.errors.push(`Missing value for ${token}`)
        continue
      }
      args.name = value
      continue
    }

    if (APP_VERSION_FLAGS.has(token)) {
      const value = argv[++i]
      if (value === undefined) {
        args.errors.push(`Missing value for ${token}`)
        continue
      }
      args.appVersion = value
      continue
    }

    if (SELF_VERSION_FLAGS.has(token)) {
      args.selfVersion = true
      continue
    }

    if (
      INCLUDE_TAG_FLAGS.has(token) ||
      EXCLUDE_TAG_FLAGS.has(token) ||
      INCLUDE_OPERATION_FLAGS.has(token) ||
      EXCLUDE_OPERATION_FLAGS.has(token)
    ) {
      const value = argv[++i]
      if (value === undefined) {
        args.errors.push(`Missing value for ${token}`)
        continue
      }
      if (INCLUDE_TAG_FLAGS.has(token)) pushCsv(args.includeTags, value)
      else if (EXCLUDE_TAG_FLAGS.has(token)) pushCsv(args.excludeTags, value)
      else if (INCLUDE_OPERATION_FLAGS.has(token)) pushCsv(args.includeOperations, value)
      else pushCsv(args.excludeOperations, value)
      continue
    }

    const equalsPrefix = LONG_VALUE_PREFIXES.find((p) => token.startsWith(p))
    if (equalsPrefix) {
      const value = token.slice(equalsPrefix.length)
      const flag = equalsPrefix.slice(0, -1)
      switch (flag) {
        case '--source':
        case '--spec':
          args.source = value
          break
        case '--base-url':
          args.baseUrl = value
          break
        case '--server-index': {
          const parsed = Number.parseInt(value, 10)
          if (Number.isNaN(parsed) || parsed < 0) {
            args.errors.push(`--server-index must be a non-negative integer, got "${value}"`)
          } else {
            args.serverIndex = parsed
          }
          break
        }
        case '--name':
          args.name = value
          break
        case '--app-version':
          args.appVersion = value
          break
        case '--include-tag':
          pushCsv(args.includeTags, value)
          break
        case '--exclude-tag':
          pushCsv(args.excludeTags, value)
          break
        case '--include-operation':
          pushCsv(args.includeOperations, value)
          break
        case '--exclude-operation':
          pushCsv(args.excludeOperations, value)
          break
      }
      continue
    }

    args.rest.push(token)
  }

  args.source ??= process.env['OPENAPI_SOURCE'] ?? process.env['OPENAPI_SOURCE_FILE']
  args.baseUrl ??= process.env['OPENAPI_BASE_URL']

  if (args.serverIndex === undefined && process.env['OPENAPI_SERVER_INDEX']) {
    const parsed = Number.parseInt(process.env['OPENAPI_SERVER_INDEX'], 10)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      args.serverIndex = parsed
    }
  }

  if (!args.source && (args.rest.length === 0 || args.rest[0] === '--help' || args.rest[0] === '-h')) {
    args.help = true
  }

  return args
}
