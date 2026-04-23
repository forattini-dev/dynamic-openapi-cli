import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ResolvedAuth } from 'dynamic-openapi-tools/auth'
import type { ParsedOperation, ParsedRequestBody, ParsedServer, ParsedSpec } from 'dynamic-openapi-tools/parser'
import { fetchWithRetry, type FetchWithRetryOptions } from 'dynamic-openapi-tools/utils'

export interface HttpClientConfig {
  baseUrl: string
  auth: ResolvedAuth | null
  defaultHeaders?: Record<string, string>
  fetchOptions?: FetchWithRetryOptions
}

export interface ExecutedRequest {
  response: Response
  url: string
  method: string
}

/**
 * Semantic description of the resolved request body. Used both as input to
 * `fetch` (via `body` on RequestInit) and as hints for downstream renderers
 * like `--dry-run` curl output.
 */
export type PreparedBodyInfo =
  | { kind: 'none' }
  | { kind: 'json'; value: unknown; contentType: string }
  | { kind: 'urlencoded'; pairs: Array<[string, string]>; contentType: string }
  | { kind: 'multipart'; fields: MultipartField[]; contentType: string }
  | {
      kind: 'binary'
      contentType: string
      /** Original @path if the body came from a file reference. */
      filePath?: string
      /** Original filename (from @path or dataBase64 payload). */
      filename?: string
      bytes: number
    }
  | { kind: 'text'; value: string; contentType: string }

export type MultipartField =
  | { name: string; kind: 'value'; value: string }
  | {
      name: string
      kind: 'file'
      /** Original @path reference (for curl rendering). */
      path?: string
      filename: string
      contentType: string
      bytes: number
    }

export interface PreparedRequest {
  url: URL
  method: string
  headers: Headers
  body: RequestInit['body']
  bodyInfo: PreparedBodyInfo
  operation: ParsedOperation
}

export class RequestError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'RequestError'
  }
}

export class ValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`Validation failed:\n${errors.map((e) => `  ${e}`).join('\n')}`)
    this.name = 'ValidationError'
  }
}

export function resolveServerUrl(server: ParsedServer, variableOverrides?: Record<string, string>): string {
  let url = server.url

  if (server.variables) {
    for (const [name, variable] of Object.entries(server.variables)) {
      const value = variableOverrides?.[name] ?? variable.default
      if (variable.enum && !variable.enum.includes(value)) {
        throw new Error(`Invalid value "${value}" for server variable "${name}". Allowed: ${variable.enum.join(', ')}`)
      }
      url = url.replaceAll(`{${name}}`, value)
    }
  }

  return normalizeUrl(url)
}

function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`
  }
  return url.replace(/\/$/, '')
}

export function resolveBaseUrl(spec: ParsedSpec, overrideBaseUrl?: string, serverIndex?: number): string {
  if (overrideBaseUrl) return overrideBaseUrl.replace(/\/$/, '')

  const index = serverIndex ?? 0
  const server = spec.servers[index]
  if (server) {
    return resolveServerUrl(server)
  }

  throw new Error('No server URL found in spec and no baseUrl provided')
}

/**
 * Build the final URL, headers and body for a request — including auth — but
 * do not fire it. This is what `--dry-run` renders and what `executeOperation`
 * passes to `fetchWithRetry`.
 */
export async function prepareRequest(
  operation: ParsedOperation,
  args: Record<string, unknown>,
  config: HttpClientConfig
): Promise<PreparedRequest> {
  const validationErrors = validateRequiredParams(operation, args)
  if (validationErrors.length > 0) {
    throw new ValidationError(validationErrors)
  }

  let urlPath = operation.path

  for (const param of operation.parameters) {
    if (param.in === 'path' && args[param.name] !== undefined) {
      const value = encodeURIComponent(String(args[param.name]))
      urlPath = urlPath.replaceAll(`{${param.name}}`, value)
    }
  }

  const url = new URL(`${config.baseUrl}${urlPath}`)

  for (const param of operation.parameters) {
    if (param.in === 'query' && args[param.name] !== undefined) {
      const val = args[param.name]
      if (Array.isArray(val)) {
        for (const item of val) {
          url.searchParams.append(param.name, String(item))
        }
      } else {
        url.searchParams.set(param.name, String(val))
      }
    }
  }

  const headers = new Headers(config.defaultHeaders)

  const produces = getResponseMediaTypes(operation)
  headers.set('Accept', produces.length > 0 ? produces.join(', ') : 'application/json')

  for (const param of operation.parameters) {
    if (param.in === 'header' && args[param.name] !== undefined) {
      headers.set(param.name, String(args[param.name]))
    }
  }

  let body: RequestInit['body']
  let bodyInfo: PreparedBodyInfo = { kind: 'none' }
  if (args['body'] !== undefined && operation.requestBody) {
    const contentType = getRequestContentType(operation.requestBody)
    const serialized = await serializeRequestBody(args['body'], contentType)
    body = serialized.body
    bodyInfo = serialized.info
    if (body instanceof FormData) {
      headers.delete('Content-Type')
    } else {
      headers.set('Content-Type', contentType)
    }
  }

  let init: RequestInit = {
    method: operation.method,
    headers,
    body,
  }

  if (config.auth) {
    try {
      init = await config.auth.apply(url, init)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new RequestError(`Authentication failed: ${msg}`, error)
    }
  }

  return {
    url,
    method: operation.method,
    headers: new Headers(init.headers),
    body: init.body,
    bodyInfo,
    operation,
  }
}

export async function executeOperation(
  operation: ParsedOperation,
  args: Record<string, unknown>,
  config: HttpClientConfig
): Promise<ExecutedRequest> {
  const prepared = await prepareRequest(operation, args, config)

  const init: RequestInit = {
    method: prepared.method,
    headers: prepared.headers,
    body: prepared.body,
  }

  let response: Response
  try {
    response = await fetchWithRetry(prepared.url.toString(), init, config.fetchOptions)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new RequestError(`Request failed: ${msg}`, error)
  }

  if (response.status === 401 && config.auth?.refresh) {
    try {
      const refreshed = await config.auth.refresh(prepared.url, init)
      response = await fetchWithRetry(prepared.url.toString(), refreshed, config.fetchOptions)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new RequestError(`Authentication refresh failed: ${msg}`, error)
    }
  }

  return { response, url: prepared.url.toString(), method: prepared.method }
}

function validateRequiredParams(
  operation: ParsedOperation,
  args: Record<string, unknown>
): string[] {
  const errors: string[] = []

  for (const param of operation.parameters) {
    if (param.required && args[param.name] === undefined) {
      errors.push(`Missing required ${param.in} parameter: "${param.name}"`)
    }
  }

  if (operation.requestBody?.required && args['body'] === undefined) {
    errors.push('Missing required request body')
  }

  return errors
}

function getResponseMediaTypes(operation: ParsedOperation): string[] {
  const types = new Set<string>()

  for (const resp of Object.values(operation.responses)) {
    if (resp.content) {
      for (const mediaType of Object.keys(resp.content)) {
        types.add(mediaType)
      }
    }
  }

  return Array.from(types)
}

function getRequestContentType(requestBody: ParsedRequestBody): string {
  const mediaTypes = Object.keys(requestBody.content)
  if (mediaTypes.length === 0) return 'application/json'

  const preferred = [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'application/octet-stream',
  ]

  for (const mediaType of preferred) {
    if (mediaTypes.includes(mediaType)) return mediaType
  }

  const jsonLike = mediaTypes.find((mediaType) => mediaType.endsWith('+json'))
  return jsonLike ?? mediaTypes[0] ?? 'application/json'
}

interface SerializedBody {
  body: RequestInit['body']
  info: PreparedBodyInfo
}

async function serializeRequestBody(body: unknown, contentType: string): Promise<SerializedBody> {
  if (isJsonContentType(contentType)) {
    try {
      return {
        body: JSON.stringify(body),
        info: { kind: 'json', value: body, contentType },
      }
    } catch {
      throw new Error('request body could not be serialized to JSON')
    }
  }

  const mimeType = getMimeType(contentType)

  if (mimeType === 'application/x-www-form-urlencoded') {
    return serializeUrlEncodedBody(body, contentType)
  }

  if (mimeType === 'multipart/form-data') {
    return serializeMultipartBody(body, contentType)
  }

  if (isBinaryContentType(contentType)) {
    return serializeBinaryBody(body, contentType)
  }

  if (typeof body === 'string') {
    return {
      body,
      info: { kind: 'text', value: body, contentType },
    }
  }

  throw new Error(`request body for content type "${contentType}" must be a string, binary input, or structured form data`)
}

function serializeUrlEncodedBody(body: unknown, contentType: string): SerializedBody {
  if (typeof body === 'string') {
    const pairs = Array.from(new URLSearchParams(body).entries())
    return { body, info: { kind: 'urlencoded', pairs, contentType } }
  }

  if (body instanceof URLSearchParams) {
    return { body, info: { kind: 'urlencoded', pairs: Array.from(body.entries()), contentType } }
  }

  if (!isRecord(body)) {
    throw new Error('application/x-www-form-urlencoded body must be an object, string, or URLSearchParams')
  }

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    appendUrlEncodedValue(params, key, value)
  }
  return {
    body: params,
    info: { kind: 'urlencoded', pairs: Array.from(params.entries()), contentType },
  }
}

function appendUrlEncodedValue(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return

  if (Array.isArray(value)) {
    for (const item of value) {
      appendUrlEncodedValue(params, key, item)
    }
    return
  }

  if (isBinaryBodyInput(value)) {
    params.append(key, value.dataBase64)
    return
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    params.append(key, String(value))
    return
  }

  if (value === null) {
    params.append(key, '')
    return
  }

  params.append(key, JSON.stringify(value))
}

async function serializeMultipartBody(body: unknown, contentType: string): Promise<SerializedBody> {
  if (body instanceof FormData) {
    const fields: MultipartField[] = []
    for (const [name, value] of body.entries()) {
      if (typeof value === 'string') {
        fields.push({ name, kind: 'value', value })
      } else {
        const size = typeof (value as Blob).size === 'number' ? (value as Blob).size : 0
        const type = (value as Blob).type || 'application/octet-stream'
        const filename = (value as File).name ?? 'upload.bin'
        fields.push({ name, kind: 'file', filename, contentType: type, bytes: size })
      }
    }
    return { body, info: { kind: 'multipart', fields, contentType } }
  }

  if (!isRecord(body)) {
    throw new Error('multipart/form-data body must be an object or FormData')
  }

  const form = new FormData()
  const fields: MultipartField[] = []
  for (const [key, value] of Object.entries(body)) {
    await appendMultipartValue(form, fields, key, value)
  }
  return { body: form, info: { kind: 'multipart', fields, contentType } }
}

async function appendMultipartValue(
  form: FormData,
  fields: MultipartField[],
  key: string,
  value: unknown
): Promise<void> {
  if (value === undefined) return

  if (Array.isArray(value)) {
    for (const item of value) {
      await appendMultipartValue(form, fields, key, item)
    }
    return
  }

  if (typeof value === 'string') {
    const fileRef = parseFileReference(value)
    if (fileRef) {
      const fileContents = await readFile(fileRef.path)
      const bytes = Buffer.from(fileContents)
      const filename = path.basename(fileRef.path)
      const blob = new Blob([bytes], { type: 'application/octet-stream' })
      form.append(key, blob, filename)
      fields.push({
        name: key,
        kind: 'file',
        path: fileRef.path,
        filename,
        contentType: 'application/octet-stream',
        bytes: bytes.byteLength,
      })
      return
    }
    const literal = unescapeFileReference(value)
    form.append(key, literal)
    fields.push({ name: key, kind: 'value', value: literal })
    return
  }

  if (isBinaryBodyInput(value)) {
    const bytes = Buffer.from(value.dataBase64, 'base64')
    const filename = value.filename ?? 'upload.bin'
    const type = value.contentType ?? 'application/octet-stream'
    const blob = new Blob([bytes], { type })
    form.append(key, blob, filename)
    fields.push({ name: key, kind: 'file', filename, contentType: type, bytes: bytes.byteLength })
    return
  }

  if (value instanceof Blob) {
    form.append(key, value)
    const filename = (value as File).name ?? 'upload.bin'
    const type = value.type || 'application/octet-stream'
    fields.push({ name: key, kind: 'file', filename, contentType: type, bytes: value.size })
    return
  }

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer
      ? Uint8Array.from(new Uint8Array(value))
      : Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    form.append(key, blob, 'upload.bin')
    fields.push({
      name: key,
      kind: 'file',
      filename: 'upload.bin',
      contentType: 'application/octet-stream',
      bytes: bytes.byteLength,
    })
    return
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    form.append(key, String(value))
    fields.push({ name: key, kind: 'value', value: String(value) })
    return
  }

  if (value === null) {
    form.append(key, '')
    fields.push({ name: key, kind: 'value', value: '' })
    return
  }

  const serialized = JSON.stringify(value)
  form.append(key, serialized)
  fields.push({ name: key, kind: 'value', value: serialized })
}

async function serializeBinaryBody(body: unknown, contentType: string): Promise<SerializedBody> {
  if (typeof body === 'string') {
    const fileRef = parseFileReference(body)
    if (fileRef) {
      const bytes = await readFile(fileRef.path)
      return {
        body: bytes,
        info: {
          kind: 'binary',
          contentType,
          filePath: fileRef.path,
          filename: path.basename(fileRef.path),
          bytes: bytes.byteLength,
        },
      }
    }
    const literal = unescapeFileReference(body)
    return {
      body: literal,
      info: { kind: 'binary', contentType, bytes: Buffer.byteLength(literal, 'utf-8') },
    }
  }

  if (body instanceof Blob) {
    return { body, info: { kind: 'binary', contentType, bytes: body.size } }
  }

  if (body instanceof ArrayBuffer) {
    const bytes = new Uint8Array(body)
    return { body: bytes, info: { kind: 'binary', contentType, bytes: bytes.byteLength } }
  }

  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    return { body: bytes, info: { kind: 'binary', contentType, bytes: bytes.byteLength } }
  }

  if (isBinaryBodyInput(body)) {
    const bytes = Buffer.from(body.dataBase64, 'base64')
    return {
      body: bytes,
      info: {
        kind: 'binary',
        contentType,
        filename: body.filename,
        bytes: bytes.byteLength,
      },
    }
  }

  throw new Error('binary request body must be a string, Blob, ArrayBuffer, typed array, or { dataBase64, filename?, contentType? }')
}

/**
 * Parse a curl-style `@path` file reference. Leading `@@` is an escape for a
 * literal value starting with `@`.
 */
function parseFileReference(value: string): { path: string } | null {
  if (!value.startsWith('@')) return null
  if (value.startsWith('@@')) return null
  return { path: value.slice(1) }
}

function unescapeFileReference(value: string): string {
  if (value.startsWith('@@')) return value.slice(1)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBinaryBodyInput(value: unknown): value is {
  dataBase64: string
  filename?: string
  contentType?: string
} {
  return isRecord(value) && typeof value.dataBase64 === 'string'
}

function isJsonContentType(contentType: string): boolean {
  const mimeType = getMimeType(contentType)
  return mimeType === 'application/json' || mimeType.endsWith('+json')
}

function isBinaryContentType(contentType: string): boolean {
  const mimeType = getMimeType(contentType)
  if (mimeType.startsWith('text/')) return false
  if (mimeType.startsWith('image/')) return true
  if (mimeType.startsWith('audio/')) return true
  if (mimeType.startsWith('video/')) return true
  if (mimeType.includes('json')) return false
  if (mimeType.includes('xml')) return false
  if (mimeType === 'application/javascript') return false
  if (mimeType === 'application/x-www-form-urlencoded') return false
  if (mimeType === 'multipart/form-data') return false
  return mimeType === 'application/octet-stream'
    || mimeType === 'application/pdf'
    || mimeType === 'application/zip'
    || mimeType === 'application/gzip'
    || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || mimeType === 'application/vnd.ms-excel'
}

function getMimeType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? ''
}

export { isJsonContentType, isBinaryContentType, getMimeType }
