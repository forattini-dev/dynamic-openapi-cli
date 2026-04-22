<div align="center">

# dynamic-openapi-cli

### Any OpenAPI spec. Instant CLI.

Point it at a spec — every operation becomes a subcommand.
<br>
**OpenAPI v3** • **JSON & YAML** • **Auto-auth** • **Zero config**

</div>

---

## Quick Start

```bash
npx dynamic-openapi-cli -s https://petstore3.swagger.io/api/v3/openapi.json --help
```

Every operation in the spec becomes a subcommand. Path params are positional, query/header params are options, the request body is `--body` / `--body-file`. Help, colors, and shell completion come from [`cli-args-parser`](https://github.com/forattini-dev/cli-args-parser).

```bash
# list operations
dynamic-openapi-cli -s ./spec.yaml --help

# run one
dynamic-openapi-cli -s ./spec.yaml list-pets --limit=20 --status=available

# positional path params in URL order
dynamic-openapi-cli -s ./spec.yaml get-pet-by-id 42 -o pet.json

# send a JSON body (inline or from file)
dynamic-openapi-cli -s ./spec.yaml create-pet --body='{"name":"rex","tag":"dog"}'
dynamic-openapi-cli -s ./spec.yaml create-pet --body-file=./pet.json
```

---

## Bundle a spec into a standalone CLI

Turn any spec into a single-file bash executable. The spec is embedded as base64, and the generated CLI delegates to `dynamic-openapi-cli` under the hood.

```bash
dynamic-openapi-cli bundle -s ./petstore.yaml --name petstore-cli --out ./petstore-cli
```

That produces `./petstore-cli`, executable, commit-friendly, with:

- The OpenAPI spec embedded as base64-encoded JSON (`$ref`s dereferenced).
- An MD5 of the embedded spec baked into the shim, so `update` can detect real changes.
- A friendly error if `dynamic-openapi-cli` and `npx` are both missing.
- `--show-spec` to decode the embedded spec back to stdout.
- `--spec-md5` to print just the hash (handy for scripted checks).
- `--spec <path>` to override the embedded spec at runtime (useful during dev).
- `update` subcommand that re-fetches the original spec and rewrites the file in-place.
- Environment variables (`OPENAPI_AUTH_TOKEN`, `OPENAPI_API_KEY`, …) propagated automatically.

```bash
# the bundled CLI behaves exactly like the original, but with its own name/version
./petstore-cli --help                 # shows "petstore-cli v1.0.0"
./petstore-cli list-pets --limit=20
./petstore-cli --show-spec | jq .info
./petstore-cli --spec ./dev-spec.yaml list-pets   # dev override
```

### Making the bundled CLI globally available

You have three options, from the most convenient to the most "batteries-included":

**1. `install` subcommand (recommended)**

Every bundled CLI ships with built-in `install` / `uninstall` subcommands. By default it symlinks into `$XDG_BIN_HOME` (or `$HOME/.local/bin`) — no sudo required:

```bash
./petstore-cli install                    # symlinks to ~/.local/bin/petstore-cli
./petstore-cli install --dir /usr/local/bin --copy    # copy (needs write access / sudo)
./petstore-cli install --force            # overwrite an existing install
./petstore-cli uninstall                  # remove it again
```

If the target directory isn't on your `PATH` yet, the command prints the exact `export PATH=...` line to paste into your shell rc. Symlinking (default) means `./my-cli update` in the original location transparently refreshes the global shortcut too — no re-install needed.

**2. Manual move / symlink**

Plain UNIX, nothing special:

```bash
# move
mv ./petstore-cli /usr/local/bin/
# or: commit the shim into your repo and symlink
ln -s "$PWD/petstore-cli" /usr/local/bin/petstore-cli
```

**3. Publish as an npm package**

Since the shim is a single executable file, you can wrap it in a tiny npm package and publish — users then install with `npm install -g your-cli`:

```bash
# minimal package.json next to the shim
{
  "name": "petstore-cli",
  "version": "1.0.0",
  "bin": { "petstore-cli": "./petstore-cli" },
  "files": ["petstore-cli"]
}

# then
npm publish             # publish once
npm install -g petstore-cli    # any user, any machine with Node 18+
```

Good fit when you already have CI/CD publishing to npm and want the CLI to follow the same distribution path as your other tools. The shim still delegates to `dynamic-openapi-cli` at runtime, so consumers need `dynamic-openapi-cli` on their PATH (or just npx, automatic).

### Self-update

The bundle remembers where the spec came from (URL or absolute file path). Running `update` re-fetches it, regenerates the shim, and atomically replaces the current file.

**The CLI version is a snapshot of the API version, not an independent CLI version.** By default `update` tracks the fresh `info.version` from the re-fetched spec:

```bash
./petstore-cli --help                 # petstore-cli 1.0.0 (bundled from spec v1.0.0)
./petstore-cli --spec-md5             # bb864f7025e1408ccdc00f11f5c0e8bb

# ... API evolves on the server to v1.1.0 ...

./petstore-cli update
# → petstore-cli update: spec changed (md5 bb864f70 → a12c9e31), … 1.0.0 → 1.1.0.

./petstore-cli --help                 # petstore-cli 1.1.0
./petstore-cli update                 # idempotent: "spec unchanged (md5 a12c9e31), is up to date"
```

Other modes:

```bash
./petstore-cli update --app-version=2.0.0    # opt-in override (decouple CLI version from spec)
./petstore-cli update --spec ./dev.yaml      # temporarily point at a different source
./petstore-cli update --help
```

If the bundle was built from an inline spec (raw JSON/YAML string), `update` fails loudly — inline specs have no remote source to refresh. Re-run `dynamic-openapi-cli bundle` manually in that case.

### Bundle options

| Flag | Required | Description |
|:-----|:---------|:------------|
| `-s, --source <url\|file>` | yes | OpenAPI spec source |
| `--name <string>` | yes | Name of the generated CLI (shown in `--help`) |
| `--out <path>` | yes | Output path for the bash shim |
| `--app-version <string>` | no | Version shown in `--help` (default: spec version) |
| `--description <string>` | no | Description shown in `--help` (default: spec title) |

---

## Installation

```bash
npm install -g dynamic-openapi-cli
# or
pnpm add -g dynamic-openapi-cli
# or run without installing
npx dynamic-openapi-cli ...
```

---

## Authentication

Environment variables mirror the MCP sibling project — same variables, same resolution order (programmatic config → per-scheme env var → global env var).

| Scheme | Env var | Programmatic |
|:-------|:--------|:-------------|
| Bearer | `OPENAPI_AUTH_TOKEN` or `OPENAPI_AUTH_<SCHEME>_TOKEN` | `auth.bearerToken` |
| API Key | `OPENAPI_API_KEY` or `OPENAPI_AUTH_<SCHEME>_KEY` | `auth.apiKey` |
| Basic | `OPENAPI_AUTH_<SCHEME>_TOKEN` as `user:pass` | `auth.basicAuth` |
| OAuth2 client credentials | — | `auth.oauth2` |
| Custom token exchange | — | `auth.tokenExchange` |

Per-scheme env vars are derived from the `securitySchemes` name in the spec:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
```

maps to `OPENAPI_AUTH_BEARERAUTH_TOKEN`.

```bash
OPENAPI_AUTH_TOKEN=sk-123 dynamic-openapi-cli -s ./spec.yaml list-pets
```

---

## CLI reference

```
dynamic-openapi-cli [bootstrap flags] <command> [...args]

Bootstrap flags:
  -s, --source <url|file>       OpenAPI spec URL, file path, or inline JSON/YAML
      --spec <url|file>         Alias for --source (used by bundled shims)
  -b, --base-url <url>          Override the base URL from the spec
      --server-index <n>        Use the Nth server entry (default: 0)
      --name <string>           Display name in help (for bundled CLIs)
      --app-version <string>    Display version in help (for bundled CLIs)
      --self-version            Print dynamic-openapi-cli's own version and exit
  -h, --help                    Show help (global or per-command)

Global options (available on every subcommand):
  -o, --output <file>           Write response body to file
      --raw                     Do not pretty-print JSON responses
  -V, --verbose                 Print HTTP status + headers to stderr

Subcommands:
  bundle                        Package a spec into a standalone bash CLI
  <operation-id-as-kebab>       Any operation from the loaded spec
```

| Environment | Purpose |
|:------------|:--------|
| `OPENAPI_SOURCE` | Spec URL or file (alternative to `-s`) |
| `OPENAPI_BASE_URL` | Override base URL |
| `OPENAPI_SERVER_INDEX` | Select server entry |
| `OPENAPI_AUTH_TOKEN` | Bearer token |
| `OPENAPI_API_KEY` | API key |

---

## How the mapping works

| OpenAPI | CLI |
|:--------|:----|
| `operationId: listPets` | Command name: `list-pets` (kebab-cased) |
| `GET /pets/{petId}` (no operationId) | Command name derived from method + path |
| `summary` / `description` | Command description |
| Path params (in URL order) | Required positional args |
| Query / header / cookie params | `--options` with type coercion + `choices` from `enum` |
| Parameter `default` | Option default |
| Request body | `--body <json>` and `--body-file <path>` |

Response handling:

- `application/json` → pretty-printed to stdout (add `--raw` to skip pretty-print).
- Other text media types → written verbatim.
- Binary payloads ≤ 256 KB → inlined as `{ contentType, byteLength, encoding: 'base64', data }`.
- Binary payloads > 256 KB → require `-o <file>`.

Exit codes: `0` success, `1` network/5xx failures, `2` validation / 4xx.

---

## Programmatic usage

```typescript
import { loadSpec, resolveSpec, buildCli, runCli } from 'dynamic-openapi-cli'

const doc = await loadSpec('./spec.yaml')
const spec = await resolveSpec(doc)
const cli = buildCli({
  spec,
  name: 'my-api',
  authConfig: { bearerToken: process.env.API_TOKEN! },
})

await runCli(cli, process.argv.slice(2))
```

You can also reach lower:

```typescript
import { executeOperation, resolveBaseUrl, resolveAuth } from 'dynamic-openapi-cli'

const baseUrl = resolveBaseUrl(spec)
const auth = resolveAuth({ bearerToken: 'sk-…' }, spec.securitySchemes)
const op = spec.operations.find((o) => o.operationId === 'listPets')!

const { response } = await executeOperation(op, { limit: 20 }, { baseUrl, auth })
console.log(await response.json())
```

---

## License

MIT
