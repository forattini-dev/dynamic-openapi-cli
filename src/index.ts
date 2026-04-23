// Re-export the shared building blocks from dynamic-openapi-tools so downstream
// consumers of dynamic-openapi-cli do not break after the modules moved out of
// this package. Keep the surface identical to what src/index.ts used to export.
export {
  loadSpec,
  resolveSource,
  resolveSpec,
  filterOperations,
} from 'dynamic-openapi-tools/parser'
export type {
  OperationFilter,
  OperationFilters,
  ParsedSpec,
  ParsedOperation,
  ParsedParameter,
  ParsedRequestBody,
  ParsedResponse,
  ParsedServer,
  ParsedServerVariable,
  ParsedTag,
  ExternalDocs,
} from 'dynamic-openapi-tools/parser'

export { resolveAuth } from 'dynamic-openapi-tools/auth'
export type {
  AuthConfig,
  ResolvedAuth,
  TokenExchangeAuthConfig,
  TokenExchangeRequestConfig,
  TokenExchangeResponseConfig,
  TokenExchangeApplyConfig,
} from 'dynamic-openapi-tools/auth'

export { OAuth2AuthCodeFlow } from './auth/oauth2-auth-code.js'
export type { OAuth2AuthCodeConfig } from './auth/oauth2-auth-code.js'
export { detectOAuth2AuthCode, createOAuth2AuthCodeAuth } from './auth/resolve.js'

export { fetchWithRetry } from 'dynamic-openapi-tools/utils'
export type { FetchWithRetryOptions, RetryPolicy } from 'dynamic-openapi-tools/utils'

export {
  executeOperation,
  resolveBaseUrl,
  resolveServerUrl,
  RequestError,
  ValidationError,
} from './http/client.js'
export type { HttpClientConfig, ExecutedRequest } from './http/client.js'

export { buildCommandsFromSpec } from './cli/command-builder.js'
export { buildBundle } from './cli/bundle.js'
export type { BuildCliOptions } from './cli/app.js'
export { buildCli, runCli } from './cli/app.js'
