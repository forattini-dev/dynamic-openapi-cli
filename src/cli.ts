import { loadSpec } from './parser/loader.js'
import { resolveSpec } from './parser/resolver.js'
import type { OperationFilters } from './parser/filter.js'
import { buildCli, runCli } from './cli/app.js'
import { preScan, type BootstrapArgs } from './cli/bootstrap.js'
import { runBundle } from './cli/bundle.js'

const SELF_VERSION = '0.1.0'

const BOOTSTRAP_HELP = `
dynamic-openapi-cli — Turn any OpenAPI v3 spec into a CLI

Usage:
  dynamic-openapi-cli -s <url|file> <command> [...args]
  dynamic-openapi-cli bundle -s <url|file> --name <cli-name> --out <path>

Bootstrap flags:
  -s, --source <url|file>       OpenAPI spec URL, file path, or inline JSON/YAML
      --spec <url|file>         Alias for --source
  -b, --base-url <url>          Override the base URL from the spec
      --server-index <n>        Use the Nth server entry (default: 0)
      --name <string>           Display name in help (for bundled CLIs)
      --app-version <string>    Display version in help (for bundled CLIs)
      --include-tag <name>      Only expose operations with this tag (repeatable, comma-separated)
      --exclude-tag <name>      Hide operations with this tag (repeatable, comma-separated)
      --include-operation <id>  Only expose these operationIds (repeatable, comma-separated)
      --exclude-operation <id>  Hide these operationIds (repeatable, comma-separated)
      --self-version            Print dynamic-openapi-cli's own version and exit
  -h, --help                    Show this help

  Operations marked with \`x-hidden: true\` in the spec are always hidden.

Subcommands (no spec required):
  bundle                        Package a spec into a standalone bash CLI (run "bundle --help")

Environment:
  OPENAPI_SOURCE, OPENAPI_BASE_URL, OPENAPI_SERVER_INDEX
  OPENAPI_AUTH_TOKEN            Bearer token
  OPENAPI_API_KEY               API key
  OPENAPI_AUTH_<SCHEME>_TOKEN   Per-scheme token

Examples:
  dynamic-openapi-cli -s https://petstore3.swagger.io/api/v3/openapi.json list-pets --limit=20
  dynamic-openapi-cli -s ./spec.yaml get-pet 42 -o pet.json
  dynamic-openapi-cli bundle -s ./spec.yaml --name petstore-cli --out ./petstore-cli
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  if (argv[0] === 'bundle') {
    await runBundle(argv.slice(1))
    return
  }

  const bootstrap = preScan(argv)

  if (bootstrap.selfVersion) {
    process.stdout.write(`dynamic-openapi-cli ${SELF_VERSION}\n`)
    return
  }

  if (bootstrap.errors.length > 0) {
    for (const err of bootstrap.errors) process.stderr.write(`${err}\n`)
    process.exit(2)
  }

  if (!bootstrap.source) {
    process.stdout.write(BOOTSTRAP_HELP.trimStart())
    process.exit(bootstrap.help ? 0 : 1)
  }

  try {
    const doc = await loadSpec(bootstrap.source)
    const spec = await resolveSpec(doc)
    const cli = buildCli({
      spec,
      name: bootstrap.name,
      version: bootstrap.appVersion,
      baseUrl: bootstrap.baseUrl,
      serverIndex: bootstrap.serverIndex,
      filters: buildFilters(bootstrap),
    })
    const exitCode = await runCli(cli, bootstrap.rest)
    process.exit(exitCode)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    process.stderr.write(`dynamic-openapi-cli: ${msg}\n`)
    process.exit(1)
  }
}

function buildFilters(args: BootstrapArgs): OperationFilters | undefined {
  const filters: OperationFilters = {}
  if (args.includeTags.length > 0 || args.excludeTags.length > 0) {
    filters.tags = {}
    if (args.includeTags.length > 0) filters.tags.include = args.includeTags
    if (args.excludeTags.length > 0) filters.tags.exclude = args.excludeTags
  }
  if (args.includeOperations.length > 0 || args.excludeOperations.length > 0) {
    filters.operations = {}
    if (args.includeOperations.length > 0) filters.operations.include = args.includeOperations
    if (args.excludeOperations.length > 0) filters.operations.exclude = args.excludeOperations
  }
  return filters.tags || filters.operations ? filters : undefined
}

main()
