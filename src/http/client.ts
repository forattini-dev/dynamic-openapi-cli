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

export async function executeOperation(
  operation: ParsedOperation,
  args: Record<string, unknown>,
  config: HttpClientConfig
): Promise<ExecutedRequest> {
  const validationErrors = validateRequiredParams(operation, args)
  if (validationErrors.length > 0) {
    throw new ValidationError(validationErrors)
  }

  let path = operation.path

  for (const param of operation.parameters) {
    if (param.in === 'path' && args[param.name] !== undefined) {
      const value = encodeURIComponent(String(args[param.name]))
      path = path.replaceAll(`{${param.name}}`, value)
    }
  }

  const url = new URL(`${config.baseUrl}${path}`)

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
  if (args['body'] !== undefined && operation.requestBody) {
    const contentType = getRequestContentType(operation.requestBody)
    body = serializeRequestBody(args['body'], contentType)
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

  let response: Response
  try {
    response = await fetchWithRetry(url.toString(), init, config.fetchOptions)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new RequestError(`Request failed: ${msg}`, error)
  }

  if (response.status === 401 && config.auth?.refresh) {
    try {
      init = await config.auth.refresh(url, init)
      response = await fetchWithRetry(url.toString(), init, config.fetchOptions)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new RequestError(`Authentication refresh failed: ${msg}`, error)
    }
  }

  return { response, url: url.toString(), method: operation.method }
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

function serializeRequestBody(body: unknown, contentType: string): RequestInit['body'] {
  if (isJsonContentType(contentType)) {
    try {
      return JSON.stringify(body)
    } catch {
      throw new Error('request body could not be serialized to JSON')
    }
  }

  const mimeType = getMimeType(contentType)

  if (mimeType === 'application/x-www-form-urlencoded') {
    return serializeUrlEncodedBody(body)
  }

  if (mimeType === 'multipart/form-data') {
    return serializeMultipartBody(body)
  }

  if (isBinaryContentType(contentType)) {
    return serializeBinaryBody(body)
  }

  if (typeof body === 'string') {
    return body
  }

  throw new Error(`request body for content type "${contentType}" must be a string, binary input, or structured form data`)
}

function serializeUrlEncodedBody(body: unknown): RequestInit['body'] {
  if (typeof body === 'string' || body instanceof URLSearchParams) {
    return body
  }

  if (!isRecord(body)) {
    throw new Error('application/x-www-form-urlencoded body must be an object, string, or URLSearchParams')
  }

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    appendUrlEncodedValue(params, key, value)
  }
  return params
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

function serializeMultipartBody(body: unknown): FormData {
  if (body instanceof FormData) {
    return body
  }

  if (!isRecord(body)) {
    throw new Error('multipart/form-data body must be an object or FormData')
  }

  const form = new FormData()
  for (const [key, value] of Object.entries(body)) {
    appendMultipartValue(form, key, value)
  }
  return form
}

function appendMultipartValue(form: FormData, key: string, value: unknown): void {
  if (value === undefined) return

  if (Array.isArray(value)) {
    for (const item of value) {
      appendMultipartValue(form, key, item)
    }
    return
  }

  if (isBinaryBodyInput(value)) {
    const bytes = Buffer.from(value.dataBase64, 'base64')
    const blob = new Blob([bytes], { type: value.contentType ?? 'application/octet-stream' })
    form.append(key, blob, value.filename ?? 'upload.bin')
    return
  }

  if (value instanceof Blob) {
    form.append(key, value)
    return
  }

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer
      ? Uint8Array.from(new Uint8Array(value))
      : Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    form.append(key, new Blob([bytes], { type: 'application/octet-stream' }), 'upload.bin')
    return
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    form.append(key, String(value))
    return
  }

  if (value === null) {
    form.append(key, '')
    return
  }

  form.append(key, JSON.stringify(value))
}

function serializeBinaryBody(body: unknown): RequestInit['body'] {
  if (typeof body === 'string' || body instanceof Blob) {
    return body
  }

  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body)
  }

  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  }

  if (isBinaryBodyInput(body)) {
    return Buffer.from(body.dataBase64, 'base64')
  }

  throw new Error('binary request body must be a string, Blob, ArrayBuffer, typed array, or { dataBase64, filename?, contentType? }')
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
