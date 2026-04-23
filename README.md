<div align="center">

# dynamic-openapi-cli

### An OpenAPI spec becomes a CLI.<br>The CLI becomes a single-file executable.<br>The executable updates itself.

Point it at a spec — every operation is a subcommand.<br>
Freeze it to a bash shim — commit it, ship it, install it with one command.<br>
Run `update` when the API evolves — the shim rewrites itself in place.

[![npm version](https://img.shields.io/npm/v/dynamic-openapi-cli.svg?style=flat-square&color=F5A623)](https://www.npmjs.com/package/dynamic-openapi-cli)
[![npm downloads](https://img.shields.io/npm/dm/dynamic-openapi-cli.svg?style=flat-square&color=34C759)](https://www.npmjs.com/package/dynamic-openapi-cli)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/dynamic-openapi-cli.svg?style=flat-square&color=007AFF)](./LICENSE)

[30-second demo](#30-second-demo) · [Quick start](#quick-start) · [The family](#the-family) · [Bundle](#bundle--the-killer-feature) · [Self-update](#self-update) · [Install](#making-the-bundled-cli-globally-available) · [Auth](#authentication) · [Filtering](#filtering-operations)

</div>

---

## 30-second demo

```bash
# 1. any OpenAPI spec becomes a CLI — no install needed
$ npx dynamic-openapi-cli -s https://petstore3.swagger.io/api/v3/openapi.json --help
Petstore - OpenAPI 3.0

Usage: dynamic-openapi-cli [command] [options]

Commands:
  list-pets       List all pets
  get-pet-by-id   Find pet by ID
  create-pet      Add a new pet to the store
  update-pet      Update an existing pet
  delete-pet      Deletes a pet
  ...

# 2. call an operation — path params are positional, query params are options
$ npx dynamic-openapi-cli -s ./petstore.yml get-pet-by-id 42
{
  "id": 42,
  "name": "Rex",
  "status": "available"
}

# 3. freeze the spec into a single-file bash executable
$ dynamic-openapi-cli bundle -s ./petstore.yml --name petstore --out ./petstore
bundled "petstore" v1.0.0 → ./petstore (7.3 KB, 18 operations)

# 4. install it globally
$ ./petstore install
petstore install: symlinked ~/.local/bin/petstore → ./petstore

# 5. use it anywhere
$ petstore list-pets --status=available --limit=5

# 6. later, when the API evolves on the server
$ petstore update
petstore update: spec changed (md5 bb864f70 → e5789514), … 1.0.0 → 1.1.0.
```

That's the whole product.

---

## Quick start

```bash
# no install — just run it
npx dynamic-openapi-cli -s ./spec.yaml <command>

# or install globally once
npm install -g dynamic-openapi-cli
dynamic-openapi-cli -s ./spec.yaml <command>
```

Three ways to use it, depending on what you need:

### Mode 1 — ad-hoc (dev, scripts, CI)

```bash
dynamic-openapi-cli -s https://api.example.com/openapi.json \
  list-pets --limit=20 --status=available
```

Reads the spec fresh every run. Good for scripting, first exploration, or CI jobs where the spec is always fetched from source.

### Mode 2 — bundled (distribute a CLI)

```bash
dynamic-openapi-cli bundle \
  -s ./openapi.yml \
  --name my-api \
  --out ./my-api

chmod +x ./my-api
./my-api install
my-api list-pets --limit=20
```

Packages the spec into a single-file bash executable. Commit it, symlink it, publish it to npm. Consumer only needs Node.js + npx (no install of `dynamic-openapi-cli` required — shim falls back to `npx --yes`).

### Mode 3 — programmatic (TypeScript)

```typescript
import { loadSpec, resolveSpec, buildCli, runCli } from 'dynamic-openapi-cli'

const spec = await resolveSpec(await loadSpec('./openapi.yml'))
const cli = buildCli({
  spec,
  name: 'my-api',
  authConfig: { bearerToken: process.env.API_TOKEN! },
})

await runCli(cli, process.argv.slice(2))
```

Use the internals directly when you need a richer integration — custom auth, custom output formatting, or embedding the CLI in a larger tool.

---

## Why this, and not curl / httpie / postman-cli?

|                       | **dynamic-openapi-cli** | curl | httpie | postman-cli |
|:----------------------|:-----------------------:|:----:|:------:|:-----------:|
| Reads OpenAPI spec    | ✓                       | —    | —      | ✓           |
| Operation names as subcommands | ✓              | —    | —      | ✓           |
| Path params as positional | ✓                   | —    | —      | partial     |
| Query params as typed options with `--help` | ✓ | —    | —      | partial     |
| Enum values as `choices` | ✓                    | —    | —      | —           |
| Auto-auth from env     | ✓                       | —    | —      | ✓           |
| Works with file / URL / inline specs | ✓         | —    | —      | URL         |
| Zero-install (via npx) | ✓                       | ✓    | —      | —           |
| Bundle to single file  | ✓                       | —    | —      | —           |
| Self-updating shim     | ✓                       | —    | —      | —           |
| Pretty-print by default | ✓                      | —    | ✓      | ✓           |
| Works offline after bundle | ✓                   | ✓    | ✓      | —           |

```bash
# curl — you write the URL, the headers, the query string, the auth, every time
curl -H "Authorization: Bearer $TOKEN" \
     "https://api.example.com/pets?limit=20&status=available"

# httpie — nicer, but still stringly-typed and unaware of the spec
http GET api.example.com/pets Authorization:"Bearer $TOKEN" limit==20 status==available

# dynamic-openapi-cli — the spec knows everything already
petstore-cli list-pets --limit=20 --status=available
```

The CLI reads your OpenAPI spec and **is** the documentation: `--help` on any operation shows the path, method, parameters with their types and enum values, and where the request body fits.

---

## How it works

```
                  ┌─────────────────────────────┐
                  │  OpenAPI v3 spec            │
                  │  (URL, file, or inline)     │
                  └──────────────┬──────────────┘
                                 │
                    loadSpec + dereference ($refs)
                                 │
                                 ▼
                  ┌─────────────────────────────┐
                  │  ParsedSpec                 │
                  │  operations, schemas, auth  │
                  └──────────────┬──────────────┘
                                 │
                     ┌───────────┴───────────┐
                     ▼                       ▼
           ┌──────────────────┐    ┌────────────────────────┐
           │  Dynamic CLI     │    │  Bundle to bash shim   │
           │  (cli-args-      │    │  ./my-cli              │
           │   parser)        │    │  • SPEC_B64 (base64)   │
           │                  │    │  • SPEC_MD5            │
           │  each operation  │    │  • SPEC_SOURCE         │
           │  → subcommand    │    │  • install / update    │
           └────────┬─────────┘    │  • delegates to        │
                    │              │    dynamic-openapi-cli │
                    ▼              │    via npx             │
             HTTP request          └────────────────────────┘
             with auth + retry
                    │
                    ▼
             Pretty-printed JSON /
             Raw body / -o file
```

**One library, three entry points:** the dynamic CLI for ad-hoc runs, the `bundle` command for packaging, and the programmatic TypeScript API for deeper integrations. All three share the same parser, HTTP client, and auth layer.

---

## Command mapping

| OpenAPI | Becomes in the CLI |
|:--------|:-------------------|
| `operationId: listPets` | Command `list-pets` (kebab-cased) |
| `GET /pets/{petId}` (no `operationId`) | Command derived from method + path |
| `summary` / `description` | Command description shown in `--help` |
| Path params (in URL order) | Required **positional** args |
| Query / header / cookie params | `--options` with type coercion |
| Parameter `default` | Option default shown in `--help` |
| Parameter `enum: [a, b, c]` | `choices` — rejected values fail with error |
| `requestBody` | `--body '<json>'` and `--body-file <path>` |
| `deprecated: true` | `[deprecated]` prefix in description |

Example spec → CLI:

```yaml
# openapi.yml
paths:
  /pets/{petId}:
    get:
      operationId: getPetById
      summary: Fetch a pet by its id
      parameters:
        - { name: petId, in: path, required: true, schema: { type: integer } }
        - { name: include, in: query, schema: { type: string, enum: [owner, photos, history] } }
```

```bash
$ my-cli get-pet-by-id --help
my-cli get-pet-by-id
Fetch a pet by its id

Usage: my-cli get-pet-by-id <petId> [options]

Options:
  --include <string>     (choices: owner, photos, history)

$ my-cli get-pet-by-id 42 --include=photos
```

---

## Response handling

| Response body | Default behavior | With `--raw` | With `-o file` |
|:--------------|:-----------------|:-------------|:---------------|
| `application/json` | Pretty-printed to stdout | Written verbatim | Saved as bytes |
| Other text (`text/*`, XML, YAML) | Written verbatim | Written verbatim | Saved as bytes |
| Binary ≤ 256 KB | Inline JSON envelope with `base64` data | same | Saved as raw bytes |
| Binary > 256 KB | Error: `-o <file>` required | same | Saved as raw bytes |

Every subcommand gets four global options for free:

```
  -o, --output <file>       Save response body to file
      --raw                 Don't pretty-print JSON
  -V, --verbose             Print HTTP status + headers to stderr
      --dry-run             Print the equivalent curl command instead of firing the request
```

### `--dry-run`: preview requests as curl

Every CLI or bundled shim can print the resolved request as a `curl` command — URL, headers (including the ones resolved by auth), and body — without firing it:

```bash
$ petstore list-pets --dry-run --limit=5 --status=available
curl -X GET 'https://api.example.com/pets?limit=5&status=available' \
  -H 'accept: application/json' \
  -H 'authorization: Bearer sk-…'

$ petstore create-pet --dry-run --body='{"name":"rex"}'
curl -X POST 'https://api.example.com/pets' \
  -H 'accept: application/json' \
  -H 'content-type: application/json' \
  --data '{"name":"rex"}'
```

Useful for copy-pasting into bug reports, sharing a reproducer, or feeding another tool. Works with every body kind: JSON, URL-encoded, multipart, and binary.

### Piping bodies: `--body=-`, `--body-file`, and `@path`

| Source | How |
|:-------|:----|
| Inline literal | `--body='{"name":"rex"}'` |
| From stdin | `echo '{…}' \| my-cli create-pet --body=-` |
| From a file | `my-cli create-pet --body-file=./new-pet.json` |
| Multipart file upload | `--body='{"file":"@/path/to/a.pdf","kind":"invoice"}'` |
| Binary upload | `--body='@/path/to/blob.bin'` (for `application/octet-stream` bodies) |

`@path` works anywhere a body value can be a file reference — multipart field values, binary request bodies. Prefix with `@@` to escape (a literal string starting with `@`). The CLI reads the file at request time and streams the bytes into the multipart envelope or the request body.

### Shell completions

`cli-args-parser` generates completions for the three major shells. Both the dynamic CLI and bundled shims expose them as `completion <shell>`:

```bash
# Bash
dynamic-openapi-cli -s ./spec.yaml completion bash >> ~/.bashrc

# Zsh — drop into a dir on your $fpath, or eval it at shell startup
petstore completion zsh > "${fpath[1]}/_petstore"

# Fish
petstore completion fish > ~/.config/fish/completions/petstore.fish
```

Completions cover top-level commands and per-command options. Bundled CLIs pass through transparently, so `my-api completion bash` works on any shim.

Exit codes:

| Code | When |
|:-----|:-----|
| `0` | Success (HTTP 2xx/3xx) |
| `1` | Network error, 5xx, or unexpected failure |
| `2` | Validation error or HTTP 4xx |

---

## Bundle — the killer feature

One command turns any spec into a single-file bash executable that runs anywhere `node` runs.

```bash
dynamic-openapi-cli bundle \
  -s ./openapi.yml \
  --name petstore \
  --out ./petstore
# → bundled "petstore" v1.0.0 → ./petstore (7.3 KB, 18 operations)
```

### What's inside the shim?

- **Full OpenAPI spec**, base64-encoded and dereferenced (`$ref`s resolved).
- **MD5 hash** of the spec, baked into the file for change detection.
- **Original source** (URL or absolute path), so `update` knows where to re-fetch.
- **Runtime delegation** to `dynamic-openapi-cli` (global binary → `npx --yes` fallback → friendly error).

```bash
$ head -15 ./petstore
#!/usr/bin/env bash
# Generated by dynamic-openapi-cli
# CLI name:    petstore
# Version:     1.0.0
# Spec source: https://petstore3.swagger.io/api/v3/openapi.json
# Spec MD5:    bb864f7025e1408ccdc00f11f5c0e8bb
# Spec:        embedded as base64-encoded JSON (dereferenced OpenAPI v3)
set -euo pipefail

CLI_NAME='petstore'
CLI_VERSION='1.0.0'
SPEC_SOURCE='https://petstore3.swagger.io/api/v3/openapi.json'
SPEC_SOURCE_KIND='url'
SPEC_MD5='bb864f7025e1408ccdc00f11f5c0e8bb'
SPEC_B64='eyJvcGVuYXBpIjoiMy4wLjMi...'
```

### Subcommands every shim ships with

| Subcommand | What it does |
|:-----------|:-------------|
| `<any-operation>` | Call the mapped API operation |
| `--help` | Print help (top-level or per-command) |
| `--show-spec` | Decode and print the embedded spec as JSON |
| `--spec-md5` | Print just the MD5 hash (scriptable) |
| `--spec <url\|file>` | Override the embedded spec at runtime (dev) |
| `update` | Re-fetch the original spec and rewrite this file |
| `install` | Symlink/copy into a PATH directory |
| `uninstall` | Remove a previous install |

---

## Self-update

The shim remembers where the spec came from. When the API evolves, `update` re-fetches, regenerates, and rewrites the file in place:

```bash
$ petstore --help                     # petstore 1.0.0
$ petstore --spec-md5
bb864f7025e1408ccdc00f11f5c0e8bb

# ... the API ships v1.1.0 on the server ...

$ petstore update
petstore update: fetching https://petstore3.swagger.io/api/v3/openapi.json ...
bundled "petstore" v1.1.0 → /tmp/petstore.update.12345 (7.4 KB, 19 operations)
petstore update: spec changed (md5 bb864f70 → a12c9e31), ./petstore 1.0.0 → 1.1.0.

$ petstore --help                     # petstore 1.1.0 — new operation visible
```

**The CLI version tracks the spec version.** It's a snapshot of your API at a point in time, not a separate SemVer of the CLI tool. Override only if you actually need decoupled versioning:

```bash
petstore update                            # default: follow new spec.info.version
petstore update --app-version=2.0.0       # explicit override
petstore update --spec ./dev-spec.yml     # use a different source this time
```

**Idempotent:** running `update` when nothing changed is safe and prints `spec unchanged (md5 …)`. Perfect for a cron job or a CI step.

```bash
# Example: daily spec check
0 3 * * * /usr/local/bin/petstore update >> /var/log/petstore-update.log 2>&1
```

If the bundle was built from an inline spec (raw JSON/YAML string, not a file or URL), `update` fails loudly — there's nothing to re-fetch. Re-run `dynamic-openapi-cli bundle` manually in that case.

---

## Making the bundled CLI globally available

Three options, from "one command" to "npm ecosystem":

### 1. Built-in `install` (recommended)

```bash
./petstore install                                # symlinks to ~/.local/bin/petstore
./petstore install --dir /usr/local/bin           # another directory
./petstore install --dir /usr/local/bin --copy    # copy instead of symlink
./petstore install --force                        # overwrite an existing install
./petstore uninstall                              # remove it
```

Defaults to `$XDG_BIN_HOME` or `$HOME/.local/bin` — **no sudo needed.** If the target directory isn't on your `PATH`, the command prints the exact line to add to your shell rc:

```
petstore install: warning — ~/.local/bin is not on your PATH yet.
       Add this line to your shell rc (~/.bashrc, ~/.zshrc, or equivalent):

         export PATH="$HOME/.local/bin:$PATH"
```

**Why symlink by default:** running `update` in the original location transparently refreshes the globally-linked binary. Copy mode (`--copy`) is useful when you want the installed version frozen against further updates.

### 2. Manual move/symlink

Classic UNIX:

```bash
mv ./petstore /usr/local/bin/
# or
ln -s "$PWD/petstore" /usr/local/bin/petstore
```

### 3. Publish as an npm package

Wrap the shim in a tiny `package.json` and publish — users then install with `npm install -g <your-cli>`:

```json
{
  "name": "petstore-cli",
  "version": "1.0.0",
  "bin": { "petstore-cli": "./petstore" },
  "files": ["petstore"]
}
```

```bash
npm publish
# consumers:
npm install -g petstore-cli
petstore-cli list-pets
```

Good fit when you already have CI/CD publishing to npm and want your team's CLI to follow the same distribution path as other internal tools. Pair with a bundle step in CI to keep the shim up to date with the latest spec.

---

## Authentication

Same variables and resolution order as [`dynamic-openapi-mcp`](https://github.com/forattini-dev/dynamic-openapi-mcp) — programmatic config → per-scheme env var → global env var.

| Scheme | Env var | Programmatic |
|:-------|:--------|:-------------|
| Bearer | `OPENAPI_AUTH_TOKEN` or `OPENAPI_AUTH_<SCHEME>_TOKEN` | `auth.bearerToken` |
| API Key (header/query/cookie) | `OPENAPI_API_KEY` or `OPENAPI_AUTH_<SCHEME>_KEY` | `auth.apiKey` |
| Basic | `OPENAPI_AUTH_<SCHEME>_TOKEN` as `user:pass` | `auth.basicAuth` |
| OAuth2 client credentials | — | `auth.oauth2` (auto-refresh) |
| OAuth2 authorization code | `OPENAPI_OAUTH2_CLIENT_ID` (+ `OPENAPI_OAUTH2_SCOPES`) | `new OAuth2AuthCodeFlow({…})` |
| Custom token exchange | — | `auth.tokenExchange` (auto-refresh) |
| Fully custom | — | `auth.custom` (callback) |

Per-scheme env vars are derived from the `securitySchemes` name in your spec:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
```

maps to `OPENAPI_AUTH_BEARERAUTH_TOKEN`. Useful when a single CLI needs to talk to multiple auth realms.

```bash
# one-liner
OPENAPI_AUTH_TOKEN=sk-123 petstore list-pets

# typical dev workflow
export OPENAPI_AUTH_TOKEN=$(vault read -field=token secret/petstore)
petstore list-pets
petstore create-pet --body-file=new-pet.json
```

### OAuth2 authorization code (browser login)

When the spec declares an OAuth2 `authorizationCode` flow and `OPENAPI_OAUTH2_CLIENT_ID` is present, the CLI triggers a browser-based login on the first request — PKCE + loopback server on `127.0.0.1:7999` — and caches the token under `$XDG_DATA_HOME/dynamic-openapi-cli/tokens/`. Subsequent calls reuse the cached token and refresh it transparently when it expires.

```bash
export OPENAPI_OAUTH2_CLIENT_ID=cli-public
export OPENAPI_OAUTH2_SCOPES="read:pets write:pets"
# optional, defaults shown:
# export OPENAPI_OAUTH2_PORT=7999
# export OPENAPI_OAUTH2_REDIRECT_URI=http://127.0.0.1:7999/callback
# export OPENAPI_OAUTH2_CLIENT_SECRET=...   # confidential clients only

# Explicit login / logout (spec required):
dynamic-openapi-cli -s ./spec.yaml login         # opens a browser, writes the cached token
dynamic-openapi-cli -s ./spec.yaml logout        # removes the cached token

# Or just run any operation — login triggers automatically on the first call.
petstore list-pets
```

Per-scheme env vars (derived from the scheme name in the spec, same casing rules as other schemes) take precedence: `OPENAPI_AUTH_<SCHEME>_CLIENT_ID`, `OPENAPI_AUTH_<SCHEME>_SCOPES`, `OPENAPI_AUTH_<SCHEME>_PORT`, `OPENAPI_AUTH_<SCHEME>_REDIRECT_URI`, `OPENAPI_AUTH_<SCHEME>_CLIENT_SECRET`.

Redirect URI must match what the provider has registered — override via `OPENAPI_OAUTH2_REDIRECT_URI` (or per-scheme) when using hosts other than `127.0.0.1:<port>/callback`. The token file has mode `0600`.

---

## CLI reference

```
dynamic-openapi-cli [bootstrap flags] <command> [...args]

Bootstrap flags (before the command):
  -s, --source <url|file>       OpenAPI spec URL, file path, or inline JSON/YAML
      --spec <url|file>         Alias for --source (used by bundled shims)
  -b, --base-url <url>          Override the base URL from the spec
      --server-index <n>        Pick the Nth server entry from the spec (default: 0)
      --name <string>           Display name in help (for bundled CLIs)
      --app-version <string>    Display version in help (for bundled CLIs)
      --include-tag <name>      Only expose operations with this tag (repeatable, comma-separated)
      --exclude-tag <name>      Hide operations with this tag (repeatable, comma-separated)
      --include-operation <id>  Only expose these operationIds (repeatable, comma-separated)
      --exclude-operation <id>  Hide these operationIds (repeatable, comma-separated)
      --self-version            Print dynamic-openapi-cli's own version
  -h, --help                    Show help (global or per-command)

Global options (after the command):
  -o, --output <file>           Save response body to file
      --raw                     Skip pretty-printing
  -V, --verbose                 Print HTTP status + headers to stderr
      --dry-run                 Print the equivalent curl command instead of firing the request

Request body (for operations that accept one):
      --body <string|->         Inline body; pass "-" to read from stdin
      --body-file <path>        Read body from a file
                                Multipart / binary bodies accept "@path" for file uploads.

Subcommands (spec required):
  completion <shell>            Print a shell completion script (bash, zsh, fish)

Built-in subcommands (no spec required):
  bundle                        Package a spec into a standalone bash CLI
                                (run "bundle --help" for details)
```

### Environment

| Variable | Purpose |
|:---------|:--------|
| `OPENAPI_SOURCE` | Spec URL or file path (alternative to `-s`) |
| `OPENAPI_BASE_URL` | Override the base URL |
| `OPENAPI_SERVER_INDEX` | Select server entry (0-based) |
| `OPENAPI_AUTH_TOKEN` | Global bearer token |
| `OPENAPI_API_KEY` | Global API key |
| `OPENAPI_AUTH_<SCHEME>_TOKEN` | Per-scheme bearer/basic token |
| `OPENAPI_AUTH_<SCHEME>_KEY` | Per-scheme API key |
| `OPENAPI_OAUTH2_CLIENT_ID` | OAuth2 authorization-code client id (activates browser login) |
| `OPENAPI_OAUTH2_CLIENT_SECRET` | OAuth2 client secret (confidential clients only) |
| `OPENAPI_OAUTH2_SCOPES` | Space- or comma-separated scope list (overrides spec) |
| `OPENAPI_OAUTH2_PORT` | Loopback redirect port (default 7999) |
| `OPENAPI_OAUTH2_REDIRECT_URI` | Full redirect URI override |

---

## Filtering operations

Not every endpoint should show up as a subcommand. Two ways to trim:

### Flags (and programmatic `filters`)

```bash
# read-only CLI: only the `pets` tag passes
dynamic-openapi-cli -s ./spec.yaml --include-tag pets list-pets

# hide admin commands
dynamic-openapi-cli -s ./spec.yaml --exclude-tag admin

# allowlist a specific set of operationIds
dynamic-openapi-cli -s ./spec.yaml --include-operation listPets,getPetById

# everything under `pets`, minus one destructive op
dynamic-openapi-cli -s ./spec.yaml --include-tag pets --exclude-operation deletePet
```

Programmatic equivalent via `buildCli`:

```typescript
const cli = buildCli({
  spec,
  filters: {
    tags: { include: ['pets'], exclude: ['admin'] },
    operations: { include: ['healthCheck'], exclude: ['deletePet'] },
  },
})
```

**Precedence** (first match wins): `x-hidden` → `operations.exclude` → `operations.include` → `tags.exclude` → includes as allowlist. `operations.include` escapes a matching `tags.exclude`, but `operations.exclude` wins over everything except `x-hidden`.

### `x-hidden` vendor extension

Hide an endpoint at the spec level — no flags required, applies to every consumer:

```yaml
paths:
  /admin/reset:
    post:
      operationId: adminReset
      x-hidden: true        # always removed, no matter what filter flags say
```

Use it for endpoints that appear in the public spec but should never become CLI subcommands, MCP tools, or skill operations.

---

## Programmatic API

```typescript
import {
  loadSpec,
  resolveSpec,
  buildCli,
  runCli,
  executeOperation,
  resolveAuth,
  resolveBaseUrl,
} from 'dynamic-openapi-cli'
```

### Build a full CLI from a spec

```typescript
import { loadSpec, resolveSpec, buildCli, runCli } from 'dynamic-openapi-cli'

const spec = await resolveSpec(await loadSpec('./openapi.yml'))

const cli = buildCli({
  spec,
  name: 'my-api',
  version: '2.0.0',
  authConfig: { bearerToken: process.env.MY_API_TOKEN! },
  defaultHeaders: { 'X-Client-Id': 'my-team' },
  fetchOptions: { retries: 5, timeout: 20_000 },
})

const exitCode = await runCli(cli, process.argv.slice(2))
process.exit(exitCode)
```

### Call an operation directly (bypass the CLI layer)

```typescript
import { loadSpec, resolveSpec, executeOperation, resolveBaseUrl, resolveAuth } from 'dynamic-openapi-cli'

const spec = await resolveSpec(await loadSpec('./openapi.yml'))
const baseUrl = resolveBaseUrl(spec)
const auth = resolveAuth({ bearerToken: 'sk-…' }, spec.securitySchemes)

const op = spec.operations.find(o => o.operationId === 'listPets')!

const { response } = await executeOperation(
  op,
  { limit: 20, status: 'available' },
  { baseUrl, auth },
)

console.log(response.status, await response.json())
```

### Generate a bash bundle from your own tooling

```typescript
import { buildBundle } from 'dynamic-openapi-cli'

await buildBundle({
  source: 'https://api.example.com/openapi.json',
  name: 'example-cli',
  out: './dist/example-cli',
  appVersion: '3.0.0',
})
```

Useful in a CI step that regenerates the shim on every spec change.

---

## Installation

```bash
# once
npm install -g dynamic-openapi-cli

# or per-command
npx dynamic-openapi-cli ...

# or pin it in your project
pnpm add -D dynamic-openapi-cli
```

Requires **Node.js 18+**. TypeScript types are shipped.

---

## The family

Three complementary projects, one spec, three output surfaces — pick the one that fits the use case:

| Sibling | Output | Runs when | Best when |
|:--------|:-------|:----------|:----------|
| [`dynamic-openapi-mcp`](https://github.com/forattini-dev/dynamic-openapi-mcp) | Live MCP server (stdio) | Every tool call spins the server | You want real-time introspection, auto-refreshed OAuth tokens, typed tool I/O |
| [`dynamic-openapi-cli`](#) | **Bash CLI (optionally bundled)** | Humans and scripts invoke it | You want a commit-friendly shim humans and CI can run |
| [`dynamic-openapi-skill`](https://github.com/forattini-dev/dynamic-openapi-skill) | Static `SKILL.md` | Claude loads it on demand | You want zero runtime, diff-friendly docs, and model-driven calls via `curl` / `fetch` |

> All three share the same parser and auth layer. Switching between them is a matter of pointing them at the same spec.

### Head-to-head with the MCP sibling

Same parser, same auth, different consumer:

| | **dynamic-openapi-mcp** | **dynamic-openapi-cli** |
|:-|:------------------------|:------------------------|
| Consumer | AI agents (Claude, Cursor, Windsurf, …) | Humans at a terminal |
| Operations become | MCP tools | CLI subcommands |
| Schemas become | MCP resources (`openapi://schemas/…`) | — |
| Auth | Env vars + programmatic | Env vars + programmatic (identical) |
| Transport | stdio / MCP protocol | stdout / stderr / exit codes |
| Bundle | — | Single-file bash shim |
| Self-update | — | `update` subcommand in the shim |

Pick the MCP version when you want AI agents to call your API. Pick the CLI version when you want humans, scripts, or CI jobs to call it. Pick the [skill version](https://github.com/forattini-dev/dynamic-openapi-skill) when you want Claude to learn the API from a static markdown file — zero runtime required.

---

## Roadmap

- [x] Shell completion scripts (bash / zsh / fish) — `completion <shell>` subcommand
- [x] `--dry-run` flag that prints the curl equivalent without firing the request
- [x] Read request body from stdin (`--body=-`) for piping
- [x] First-class multipart / binary uploads from file paths (`@path`, curl-style)
- [x] OAuth2 authorization code flow (browser-based, PKCE, disk-cached tokens)

Got an idea? Open an issue.

---

## License

MIT
