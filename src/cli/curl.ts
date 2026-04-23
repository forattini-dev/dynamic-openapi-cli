import type { PreparedRequest } from '../http/client.js'

/**
 * Render the resolved request as a multiline curl command, suitable for
 * `--dry-run` output. Headers follow a stable order (the Headers object's
 * insertion order after `auth.apply`).
 */
export function renderCurl(prepared: PreparedRequest): string {
  const parts: string[] = []
  parts.push(`curl -X ${prepared.method} ${shellQuote(prepared.url.toString())}`)

  const headerEntries: Array<[string, string]> = []
  prepared.headers.forEach((value, key) => {
    headerEntries.push([key, value])
  })
  for (const [key, value] of headerEntries) {
    parts.push(`  -H ${shellQuote(`${key}: ${value}`)}`)
  }

  const bodyLines = renderBody(prepared)
  for (const line of bodyLines) {
    parts.push(`  ${line}`)
  }

  return parts.join(' \\\n')
}

function renderBody(prepared: PreparedRequest): string[] {
  const info = prepared.bodyInfo
  switch (info.kind) {
    case 'none':
      return []
    case 'json':
      return [`--data ${shellQuote(JSON.stringify(info.value))}`]
    case 'urlencoded':
      return info.pairs.map(([k, v]) => `--data-urlencode ${shellQuote(`${k}=${v}`)}`)
    case 'multipart':
      return info.fields.map((field) => {
        if (field.kind === 'value') {
          return `-F ${shellQuote(`${field.name}=${field.value}`)}`
        }
        if (field.path) {
          return `-F ${shellQuote(`${field.name}=@${field.path}`)}`
        }
        return `-F ${shellQuote(`${field.name}=@${field.filename}`)}  # ${field.bytes} bytes, ${field.contentType}`
      })
    case 'binary':
      if (info.filePath) {
        return [`--data-binary ${shellQuote(`@${info.filePath}`)}`]
      }
      return [`--data-binary @-  # ${info.bytes} bytes`]
    case 'text':
      return [`--data ${shellQuote(info.value)}`]
  }
}

/**
 * Wrap a string in single quotes, escaping any embedded single quotes the
 * POSIX way: `'` → `'\''`.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
