import { createHash } from 'node:crypto'
import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createParser } from 'cli-args-parser'
import { loadSpec, resolveSource } from '../parser/loader.js'
import { resolveSpec } from '../parser/resolver.js'

export interface BundleOptions {
  source: string
  name: string
  out: string
  appVersion?: string
  description?: string
}

export async function buildBundle(options: BundleOptions): Promise<void> {
  const doc = await loadSpec(options.source)
  const spec = await resolveSpec(doc)

  const json = JSON.stringify(spec.raw)
  const base64 = Buffer.from(json, 'utf-8').toString('base64')
  const md5 = createHash('md5').update(json).digest('hex')

  const cliName = options.name
  const cliVersion = options.appVersion ?? spec.version
  const cliDescription = options.description ?? spec.title
  const specSource = computeSpecSource(options.source)

  const script = renderShim({
    cliName,
    cliVersion,
    cliDescription,
    specSource,
    base64,
    md5,
  })

  await writeFile(options.out, script, 'utf-8')
  await chmod(options.out, 0o755)

  const bytes = Buffer.byteLength(script, 'utf-8')
  const updateHint = specSource.kind === 'inline'
    ? ' (update: unavailable — inline spec)'
    : ''
  process.stderr.write(
    `bundled "${cliName}" v${cliVersion} → ${options.out} (${formatBytes(bytes)}, ${spec.operations.length} operations)${updateHint}\n`
  )
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

interface SpecSource {
  kind: 'url' | 'file' | 'inline'
  value: string
}

function computeSpecSource(source: string): SpecSource {
  const resolved = resolveSource(source)
  switch (resolved.type) {
    case 'url':
      return { kind: 'url', value: resolved.value }
    case 'file':
      return { kind: 'file', value: path.resolve(resolved.value) }
    case 'inline':
      return { kind: 'inline', value: '' }
  }
}

interface ShimParams {
  cliName: string
  cliVersion: string
  cliDescription: string
  specSource: SpecSource
  base64: string
  md5: string
}

function renderShim(params: ShimParams): string {
  const { cliName, cliVersion, cliDescription, specSource, base64, md5 } = params
  const safeName = shellSingleQuote(cliName)
  const safeVersion = shellSingleQuote(cliVersion)
  const safeDescription = shellSingleQuote(cliDescription)
  const safeSpecSource = shellSingleQuote(specSource.value)
  const specSourceKind = shellSingleQuote(specSource.kind)
  const safeMd5 = shellSingleQuote(md5)

  return `#!/usr/bin/env bash
# Generated by dynamic-openapi-cli
# Generator:   dynamic-openapi-cli
# CLI name:    ${cliName}
# Version:     ${cliVersion}
# Spec source: ${specSource.kind === 'inline' ? '(inline — update unavailable)' : specSource.value}
# Spec MD5:    ${md5}
# Spec:        embedded as base64-encoded JSON (dereferenced OpenAPI v3)
set -euo pipefail

CLI_NAME=${safeName}
CLI_VERSION=${safeVersion}
CLI_DESCRIPTION=${safeDescription}
SPEC_SOURCE=${safeSpecSource}
SPEC_SOURCE_KIND=${specSourceKind}
SPEC_MD5=${safeMd5}

SPEC_B64='${base64}'

_self_path() {
  local src="\${BASH_SOURCE[0]}"
  local dir
  dir="$(cd "$(dirname "$src")" && pwd)"
  printf '%s/%s' "$dir" "$(basename "$src")"
}

_resolve_runner() {
  if command -v dynamic-openapi-cli >/dev/null 2>&1; then
    printf 'dynamic-openapi-cli\\n'
    return 0
  fi
  if command -v npx >/dev/null 2>&1; then
    printf 'npx --yes dynamic-openapi-cli\\n'
    return 0
  fi
  printf >&2 'Error: neither dynamic-openapi-cli nor npx was found on PATH.\\n'
  printf >&2 '       Install with: npm install -g dynamic-openapi-cli\\n'
  printf >&2 '       Or install Node.js (>= 18): https://nodejs.org\\n'
  return 127
}

if [[ "\${1:-}" == "--show-spec" ]]; then
  printf '%s' "$SPEC_B64" | base64 -d
  printf '\\n'
  exit 0
fi

if [[ "\${1:-}" == "--spec-md5" ]]; then
  printf '%s\\n' "$SPEC_MD5"
  exit 0
fi

_default_install_dir() {
  if [[ -n "\${XDG_BIN_HOME:-}" ]]; then
    printf '%s' "$XDG_BIN_HOME"
  else
    printf '%s/.local/bin' "\${HOME:-~}"
  fi
}

_is_in_path() {
  local dir="$1"
  case ":$PATH:" in
    *":$dir:"*) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ "\${1:-}" == "install" ]]; then
  shift
  TARGET_DIR="$(_default_install_dir)"
  MODE="symlink"
  FORCE=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        printf 'Usage: %s install [--dir <path>] [--copy] [--force]\\n' "$CLI_NAME"
        printf '\\n'
        printf 'Installs this CLI into a directory on your PATH.\\n'
        printf '\\n'
        printf 'Options:\\n'
        printf '  --dir <path>   Target directory (default: \\$XDG_BIN_HOME or \\$HOME/.local/bin)\\n'
        printf '  --copy         Copy the file instead of creating a symlink\\n'
        printf '  --force        Overwrite an existing file at the destination\\n'
        exit 0
        ;;
      --dir) TARGET_DIR="$2"; shift 2 ;;
      --dir=*) TARGET_DIR="\${1#--dir=}"; shift ;;
      --copy) MODE="copy"; shift ;;
      --force) FORCE=1; shift ;;
      *)
        printf >&2 '%s install: unknown argument: %s\\n' "$CLI_NAME" "$1"
        exit 2
        ;;
    esac
  done

  SELF="$(_self_path)"
  mkdir -p "$TARGET_DIR"
  LINK="$TARGET_DIR/$CLI_NAME"

  if [[ -e "$LINK" || -L "$LINK" ]]; then
    if [[ "$FORCE" -ne 1 ]]; then
      printf >&2 '%s install: %s already exists. Pass --force to overwrite.\\n' "$CLI_NAME" "$LINK"
      exit 1
    fi
    rm -f "$LINK"
  fi

  if [[ "$MODE" == "copy" ]]; then
    cp "$SELF" "$LINK"
    chmod +x "$LINK"
    printf >&2 '%s install: copied to %s\\n' "$CLI_NAME" "$LINK"
  else
    ln -s "$SELF" "$LINK"
    printf >&2 '%s install: symlinked %s → %s\\n' "$CLI_NAME" "$LINK" "$SELF"
  fi

  if ! _is_in_path "$TARGET_DIR"; then
    printf >&2 '\\n'
    printf >&2 '%s install: warning — %s is not on your PATH yet.\\n' "$CLI_NAME" "$TARGET_DIR"
    printf >&2 '       Add this line to your shell rc (~/.bashrc, ~/.zshrc, or equivalent):\\n'
    printf >&2 '\\n'
    printf >&2 '         export PATH="%s:\$PATH"\\n' "$TARGET_DIR"
    printf >&2 '\\n'
    printf >&2 '       Then run:  exec \$SHELL   (or open a new terminal)\\n'
  else
    printf >&2 '       Run:  %s --help\\n' "$CLI_NAME"
  fi
  exit 0
fi

if [[ "\${1:-}" == "uninstall" ]]; then
  shift
  TARGET_DIR="$(_default_install_dir)"
  FORCE=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        printf 'Usage: %s uninstall [--dir <path>] [--force]\\n' "$CLI_NAME"
        exit 0
        ;;
      --dir) TARGET_DIR="$2"; shift 2 ;;
      --dir=*) TARGET_DIR="\${1#--dir=}"; shift ;;
      --force) FORCE=1; shift ;;
      *)
        printf >&2 '%s uninstall: unknown argument: %s\\n' "$CLI_NAME" "$1"
        exit 2
        ;;
    esac
  done

  SELF="$(_self_path)"
  LINK="$TARGET_DIR/$CLI_NAME"

  if [[ ! -e "$LINK" && ! -L "$LINK" ]]; then
    printf >&2 '%s uninstall: %s does not exist.\\n' "$CLI_NAME" "$LINK"
    exit 1
  fi

  if [[ "$FORCE" -ne 1 ]]; then
    if [[ -L "$LINK" ]]; then
      RESOLVED="$(readlink "$LINK" 2>/dev/null || true)"
      if [[ "$RESOLVED" != "$SELF" ]]; then
        printf >&2 '%s uninstall: %s is a symlink to %s, not to this CLI. Pass --force to remove anyway.\\n' \\
          "$CLI_NAME" "$LINK" "$RESOLVED"
        exit 1
      fi
    elif ! cmp -s "$LINK" "$SELF"; then
      printf >&2 '%s uninstall: %s differs from this CLI. Pass --force to remove anyway.\\n' "$CLI_NAME" "$LINK"
      exit 1
    fi
  fi

  rm -f "$LINK"
  printf >&2 '%s uninstall: removed %s\\n' "$CLI_NAME" "$LINK"
  exit 0
fi

if [[ "\${1:-}" == "update" ]]; then
  shift
  UPDATE_SPEC=""
  UPDATE_VERSION_OVERRIDE=""
  UPDATE_VERSION_SET=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        printf 'Usage: %s update [--spec <url|file>] [--app-version <version>]\\n' "$CLI_NAME"
        printf '\\n'
        printf 'Re-fetches the original spec and rewrites this CLI in-place.\\n'
        printf '\\n'
        printf 'By default, the new CLI_VERSION tracks the spec.info.version of the freshly\\n'
        printf 'fetched spec — the bundled version is a snapshot of the API, not of the CLI.\\n'
        printf '\\n'
        printf 'Options:\\n'
        printf '  --spec <url|file>        Use a different spec source (default: the one baked in at bundle time)\\n'
        printf '  --app-version <version>  Override the version written to the new shim\\n'
        exit 0
        ;;
      --spec)
        if [[ $# -lt 2 ]]; then
          printf >&2 '%s update: --spec requires a value\\n' "$CLI_NAME"
          exit 2
        fi
        UPDATE_SPEC="$2"
        shift 2
        ;;
      --spec=*)
        UPDATE_SPEC="\${1#--spec=}"
        shift
        ;;
      --app-version)
        if [[ $# -lt 2 ]]; then
          printf >&2 '%s update: --app-version requires a value\\n' "$CLI_NAME"
          exit 2
        fi
        UPDATE_VERSION_OVERRIDE="$2"
        UPDATE_VERSION_SET=1
        shift 2
        ;;
      --app-version=*)
        UPDATE_VERSION_OVERRIDE="\${1#--app-version=}"
        UPDATE_VERSION_SET=1
        shift
        ;;
      *)
        printf >&2 '%s update: unknown argument: %s\\n' "$CLI_NAME" "$1"
        exit 2
        ;;
    esac
  done

  UPDATE_SOURCE="\${UPDATE_SPEC:-$SPEC_SOURCE}"

  if [[ -z "$UPDATE_SOURCE" ]]; then
    printf >&2 '%s update: this CLI was bundled from an inline spec — no remote source to refresh.\\n' "$CLI_NAME"
    printf >&2 '       Pass --spec <url|file> to update, or re-run "dynamic-openapi-cli bundle" manually.\\n'
    exit 1
  fi

  if [[ "$SPEC_SOURCE_KIND" == "file" && -z "$UPDATE_SPEC" && ! -e "$UPDATE_SOURCE" ]]; then
    printf >&2 '%s update: baked-in spec file not found: %s\\n' "$CLI_NAME" "$UPDATE_SOURCE"
    printf >&2 '       Pass --spec <url|file> to override.\\n'
    exit 1
  fi

  RUNNER_STR="$(_resolve_runner)" || exit $?
  read -r -a RUNNER <<< "$RUNNER_STR"

  SELF="$(_self_path)"
  TMP="\${SELF}.update.$$"
  trap 'rm -f "$TMP"' EXIT

  VERSION_ARGS=()
  if [[ "$UPDATE_VERSION_SET" -eq 1 ]]; then
    VERSION_ARGS=(--app-version "$UPDATE_VERSION_OVERRIDE")
  fi

  printf >&2 '%s update: fetching %s ...\\n' "$CLI_NAME" "$UPDATE_SOURCE"
  if ! "\${RUNNER[@]}" bundle \\
        --source "$UPDATE_SOURCE" \\
        --name "$CLI_NAME" \\
        "\${VERSION_ARGS[@]}" \\
        --out "$TMP"; then
    printf >&2 '%s update: bundle failed, CLI not modified.\\n' "$CLI_NAME"
    exit 1
  fi

  NEW_VERSION="$(grep -m1 "^CLI_VERSION=" "$TMP" 2>/dev/null | sed -E "s/^CLI_VERSION='(.*)'\$/\\1/")"
  [[ -z "$NEW_VERSION" ]] && NEW_VERSION="unknown"
  NEW_MD5="$(grep -m1 "^SPEC_MD5=" "$TMP" 2>/dev/null | sed -E "s/^SPEC_MD5='(.*)'\$/\\1/")"
  [[ -z "$NEW_MD5" ]] && NEW_MD5="unknown"

  mv "$TMP" "$SELF"
  chmod +x "$SELF"
  trap - EXIT

  if [[ "$NEW_MD5" == "$SPEC_MD5" ]]; then
    printf >&2 '%s update: spec unchanged (md5 %s), %s is up to date at version %s.\\n' \\
      "$CLI_NAME" "\${NEW_MD5:0:8}" "$SELF" "$NEW_VERSION"
  else
    printf >&2 '%s update: spec changed (md5 %s → %s), %s %s → %s.\\n' \\
      "$CLI_NAME" "\${SPEC_MD5:0:8}" "\${NEW_MD5:0:8}" "$SELF" "$CLI_VERSION" "$NEW_VERSION"
  fi
  exit 0
fi

SPEC_OVERRIDE=""
PASSTHROUGH=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --spec)
      if [[ $# -lt 2 ]]; then
        printf >&2 '%s: --spec requires a value\\n' "$CLI_NAME"
        exit 2
      fi
      SPEC_OVERRIDE="$2"
      shift 2
      ;;
    --spec=*)
      SPEC_OVERRIDE="\${1#--spec=}"
      shift
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        PASSTHROUGH+=("$1")
        shift
      done
      ;;
    *)
      PASSTHROUGH+=("$1")
      shift
      ;;
  esac
done

if [[ -n "$SPEC_OVERRIDE" ]]; then
  SPEC_FILE="$SPEC_OVERRIDE"
else
  SPEC_FILE="$(mktemp -t "\${CLI_NAME}.XXXXXX.json")"
  trap 'rm -f "$SPEC_FILE"' EXIT
  printf '%s' "$SPEC_B64" | base64 -d > "$SPEC_FILE"
fi

RUNNER_STR="$(_resolve_runner)" || exit $?
read -r -a RUNNER <<< "$RUNNER_STR"

exec "\${RUNNER[@]}" \\
  --spec "$SPEC_FILE" \\
  --name "$CLI_NAME" \\
  --app-version "$CLI_VERSION" \\
  "\${PASSTHROUGH[@]}"
`
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
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
