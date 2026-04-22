import { writeFile } from 'node:fs/promises'

export interface OutputOptions {
  /** Write response body to this file instead of stdout */
  outputFile?: string
  /** Print body without pretty-printing */
  raw?: boolean
  /** Print HTTP status line and headers to stderr */
  verbose?: boolean
}

const INLINE_BINARY_LIMIT = 256 * 1024

export async function renderResponse(
  response: Response,
  options: OutputOptions = {}
): Promise<number> {
  if (options.verbose) {
    process.stderr.write(`${response.status} ${response.statusText}\n`)
    response.headers.forEach((value, key) => {
      process.stderr.write(`${key}: ${value}\n`)
    })
    process.stderr.write('\n')
  }

  const contentType = response.headers.get('Content-Type') ?? ''
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? ''

  if (options.outputFile) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    await writeFile(options.outputFile, bytes)
    process.stderr.write(`wrote ${bytes.byteLength} bytes to ${options.outputFile}\n`)
    return exitCodeFor(response)
  }

  if (isTextMedia(mediaType)) {
    const text = await response.text()
    if (options.raw || !isJsonMedia(mediaType)) {
      process.stdout.write(text)
      if (!text.endsWith('\n')) process.stdout.write('\n')
      return exitCodeFor(response)
    }
    process.stdout.write(prettyJson(text))
    process.stdout.write('\n')
    return exitCodeFor(response)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())

  if (bytes.byteLength <= INLINE_BINARY_LIMIT) {
    const base64 = Buffer.from(bytes).toString('base64')
    const payload = {
      contentType: mediaType || 'application/octet-stream',
      byteLength: bytes.byteLength,
      encoding: 'base64',
      data: base64,
    }
    process.stdout.write(JSON.stringify(payload, null, 2))
    process.stdout.write('\n')
    return exitCodeFor(response)
  }

  process.stderr.write(
    `binary response (${bytes.byteLength} bytes, ${mediaType || 'application/octet-stream'}) too large to inline — pass --output <file> to save\n`
  )
  return 1
}

function prettyJson(text: string): string {
  try {
    const parsed = JSON.parse(text)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return text
  }
}

function isTextMedia(mediaType: string): boolean {
  if (!mediaType) return true
  if (mediaType.startsWith('text/')) return true
  if (isJsonMedia(mediaType)) return true
  if (mediaType.includes('xml')) return true
  if (mediaType === 'application/javascript') return true
  if (mediaType === 'application/x-www-form-urlencoded') return true
  return false
}

function isJsonMedia(mediaType: string): boolean {
  return mediaType === 'application/json' || mediaType.endsWith('+json')
}

function exitCodeFor(response: Response): number {
  if (response.ok) return 0
  return response.status >= 400 && response.status < 500 ? 2 : 1
}
