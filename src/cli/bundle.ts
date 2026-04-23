import path from 'node:path'
import { createParser } from 'cli-args-parser'
import { buildBundle as toolsBuildBundle, type BuildBundleResult } from 'dynamic-openapi-tools/bundle'

export interface BundleOptions {
  source: string
  name: string
  out: string
  appVersion?: string
  description?: string
}

const RUNNER_PACKAGE = 'dynamic-openapi-cli'
const KIND_LABEL = 'CLI'
const RUNNER_INVOCATION =
  '--spec "$SPEC_FILE" --name "$CLI_NAME" --app-version "$CLI_VERSION" "${PASSTHROUGH[@]}"'
const INSTALL_SUCCESS_HINT = 'Run:  %s --help'

/**
 * Build a standalone bash CLI around the shared dynamic-openapi-tools renderer
 * and emit the same stderr summary the previous inline implementation printed.
 */
export async function buildBundle(options: BundleOptions): Promise<BuildBundleResult> {
  const result = await toolsBuildBundle({
    source: options.source,
    name: options.name,
    out: options.out,
    appVersion: options.appVersion,
    description: options.description,
    runnerPackage: RUNNER_PACKAGE,
    kindLabel: KIND_LABEL,
    runnerInvocation: RUNNER_INVOCATION,
    installSuccessHint: INSTALL_SUCCESS_HINT,
  })

  const updateHint = result.specSource.kind === 'inline'
    ? ' (update: unavailable — inline spec)'
    : ''
  process.stderr.write(
    `bundled "${options.name}" v${result.version} → ${options.out} (${formatBytes(result.bytes)}, ${result.operations} operations)${updateHint}\n`
  )

  return result
}

const BUNDLE_HELP = `
dynamic-openapi-cli bundle — package an OpenAPI spec into a standalone bash CLI

Usage:
  dynamic-openapi-cli bundle -s <url|file> --name <cli-name> --out <path> [options]

Options:
  -s, --source <url|file>    OpenAPI spec source (required)
      --name <string>        Name of the generated CLI (required)
      --out <path>           Output path for the generated bash shim (required)
      --app-version <string> Version shown in the generated CLI's help (default: spec.version)
      --description <string> Description shown in the generated CLI's help (default: spec.title)
  -h, --help                 Show this help

Bundled CLIs expose these subcommands in addition to the spec operations:
  --show-spec                Decode and print the embedded spec
  --spec-md5                 Print the md5 hash of the embedded spec
  --spec <url|file>          Override the embedded spec at runtime
  update                     Re-fetch the original spec and self-update this file
  install                    Symlink (or copy) the CLI into a PATH directory
  uninstall                  Remove a previous "install"

Examples:
  dynamic-openapi-cli bundle -s ./petstore.yml --name petstore-cli --out ./petstore-cli
  dynamic-openapi-cli bundle -s https://api.example.com/openapi.json --name my-api --out ./bin/my-api
`

export async function runBundle(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(BUNDLE_HELP.trimStart())
    return
  }

  const parser = createParser({
    options: {
      source: { short: 's', type: 'string', required: true, aliases: ['spec'] },
      name: { type: 'string', required: true },
      out: { type: 'string', required: true },
      'app-version': { type: 'string' },
      description: { type: 'string' },
    },
  })

  const result = parser.parse(argv)

  if (result.errors.length > 0) {
    for (const err of result.errors) process.stderr.write(`bundle: ${err}\n`)
    process.exit(2)
  }

  try {
    await buildBundle({
      source: String(result.options['source']),
      name: String(result.options['name']),
      out: path.resolve(String(result.options['out'])),
      appVersion: pickString(result.options['app-version']),
      description: pickString(result.options['description']),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    process.stderr.write(`bundle: ${msg}\n`)
    process.exit(1)
  }
}

function pickString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  return undefined
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
