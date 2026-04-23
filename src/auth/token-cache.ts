import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export interface CachedToken {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_at: number
  scopes: string[]
}

export function tokenCacheDir(): string {
  const xdg = process.env['XDG_DATA_HOME']
  if (xdg && xdg.length > 0) {
    return path.join(xdg, 'dynamic-openapi-cli', 'tokens')
  }
  return path.join(homedir(), '.local', 'share', 'dynamic-openapi-cli', 'tokens')
}

export function tokenCachePath(key: string): string {
  return path.join(tokenCacheDir(), `${sanitizeKey(key)}.json`)
}

export async function readTokenCache(key: string): Promise<CachedToken | null> {
  try {
    const raw = await readFile(tokenCachePath(key), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.access_token !== 'string') return null
    if (typeof parsed.expires_at !== 'number') return null
    if (typeof parsed.token_type !== 'string') return null
    if (!Array.isArray(parsed.scopes)) return null
    return parsed as CachedToken
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return null
  }
}

export async function writeTokenCache(key: string, token: CachedToken): Promise<void> {
  const dir = tokenCacheDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = tokenCachePath(key)
  await writeFile(file, JSON.stringify(token, null, 2), { mode: 0o600 })
}

export async function deleteTokenCache(key: string): Promise<void> {
  try {
    await rm(tokenCachePath(key), { force: true })
  } catch {
    // best-effort
  }
}

/**
 * Sanitize a cache key for use as a filename — collapse any path separators
 * or non-word characters into dashes so a scheme name never escapes the
 * tokens/ directory.
 */
function sanitizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]+/g, '-')
}
