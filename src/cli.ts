import { pathToFileURL } from 'node:url'
import { loadSpec, resolveSpec, type OperationFilters } from 'dynamic-openapi-tools/parser'
import { createOAuth2AuthCodeAuth, detectOAuth2AuthCode } from './auth/resolve.js'
import { OAuth2AuthCodeFlow } from './auth/oauth2-auth-code.js'
import { buildCli, runCli } from './cli/app.js'
import { preScan, type BootstrapArgs } from './cli/bootstrap.js'
import { runBundle } from './cli/bundle.js'

const SELF_VERSION = '0.1.0'

const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish'] as const
type SupportedShell = (typeof SUPPORTED_SHELLS)[number]

const BOOTSTRAP_HELP = `
dynamic-openapi-cli — Turn any OpenAPI v3 spec into a CLI

Usage:
  dynamic-openapi-cli -s <url|file> <command> [...args]
  dynamic-openapi-cli -s <url|file> completion <bash|zsh|fish>
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

Subcommands:
  completion <shell>            Print a shell completion script (bash, zsh, fish); requires --source
  login                         Run the OAuth2 authorization-code flow (spec must declare one)
  logout                        Remove the cached OAuth2 token
  bundle                        Package a spec into a standalone bash CLI (run "bundle --help")

Global options (after the command):
  -o, --output <file>           Save response body to file
      --raw                     Skip pretty-printing
  -V, --verbose                 Print HTTP status + headers to stderr
      --dry-run                 Print the equivalent curl command instead of firing the request

Request body:
      --body <string|->         Inline body; pass "-" to read from stdin
      --body-file <path>        Read body from a file

Environment:
  OPENAPI_SOURCE, OPENAPI_BASE_URL, OPENAPI_SERVER_INDEX
  OPENAPI_AUTH_TOKEN            Bearer token
  OPENAPI_API_KEY               API key
  OPENAPI_AUTH_<SCHEME>_TOKEN   Per-scheme token

Examples:
  dynamic-openapi-cli -s https://petstore3.swagger.io/api/v3/openapi.json list-pets --limit=20
  dynamic-openapi-cli -s ./spec.yaml get-pet 42 -o pet.json
  dynamic-openapi-cli -s ./spec.yaml completion bash >> ~/.bashrc
  dynamic-openapi-cli bundle -s ./spec.yaml --name petstore-cli --out ./petstore-cli
`

export async function main(processArgv: string[] = process.argv): Promise<void> {
  const argv = processArgv.slice(2)

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

  const completionShell = resolveCompletionShell(bootstrap.rest)
  if (completionShell === 'invalid') process.exit(2)

  try {
    const doc = await loadSpec(bootstrap.source)
    const spec = await resolveSpec(doc)

    if (bootstrap.rest[0] === 'login') {
      await runLogin(spec.securitySchemes)
      return
    }
    if (bootstrap.rest[0] === 'logout') {
      await runLogout(spec.securitySchemes)
      return
    }

    const cli = buildCli({
      spec,
      name: bootstrap.name,
      version: bootstrap.appVersion,
      baseUrl: bootstrap.baseUrl,
      serverIndex: bootstrap.serverIndex,
      filters: buildFilters(bootstrap),
    })

    if (completionShell) {
      const script = cli.completion(completionShell)
      process.stdout.write(script)
      if (!script.endsWith('\n')) process.stdout.write('\n')
      return
    }

    const exitCode = await runCli(cli, bootstrap.rest)
    process.exit(exitCode)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    process.stderr.write(`dynamic-openapi-cli: ${msg}\n`)
    process.exit(1)
  }
}

async function runLogin(
  securitySchemes: Parameters<typeof detectOAuth2AuthCode>[0]
): Promise<void> {
  const detected = detectOAuth2AuthCode(securitySchemes)
  if (!detected) {
    process.stderr.write(
      'login: no OAuth2 authorization-code flow is configured. Set OPENAPI_OAUTH2_CLIENT_ID (and OPENAPI_OAUTH2_SCOPES if needed) and ensure the spec declares an authorizationCode flow.\n'
    )
    process.exit(2)
  }
  const auth = createOAuth2AuthCodeAuth(detected.config) as OAuth2AuthCodeFlow
  const token = await auth.forceLogin()
  process.stderr.write(
    `login: cached token for scheme "${detected.schemeName}" (expires at ${new Date(token.expires_at).toISOString()})\n`
  )
}

async function runLogout(
  securitySchemes: Parameters<typeof detectOAuth2AuthCode>[0]
): Promise<void> {
  const detected = detectOAuth2AuthCode(securitySchemes)
  if (!detected) {
    process.stderr.write('logout: no OAuth2 authorization-code flow is configured; nothing to remove.\n')
    return
  }
  const auth = createOAuth2AuthCodeAuth(detected.config) as OAuth2AuthCodeFlow
  await auth.logout()
  process.stderr.write(`logout: removed cached token for scheme "${detected.schemeName}"\n`)
}

/**
 * Peek at the first two rest-args: if the user invoked `completion <shell>`,
 * return the shell; if the invocation is a completion request with a bad
 * shell, print the error and return 'invalid' so the caller can exit(2)
 * outside of any try/catch.
 */
function resolveCompletionShell(rest: string[]): SupportedShell | 'invalid' | null {
  if (rest[0] !== 'completion') return null
  const shell = rest[1]
  if (!shell) {
    process.stderr.write(`completion: missing shell argument (expected one of: ${SUPPORTED_SHELLS.join(', ')})\n`)
    return 'invalid'
  }
  if (!isSupportedShell(shell)) {
    process.stderr.write(`completion: unknown shell "${shell}" (expected one of: ${SUPPORTED_SHELLS.join(', ')})\n`)
    return 'invalid'
  }
  return shell
}

function isSupportedShell(shell: string): shell is SupportedShell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(shell)
}

export function buildFilters(args: BootstrapArgs): OperationFilters | undefined {
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

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
}
