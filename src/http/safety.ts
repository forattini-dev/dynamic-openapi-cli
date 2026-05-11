import type { ParsedOperation } from 'dynamic-openapi-tools/parser'

export type SideEffect = 'read-only' | 'write' | 'destructive'

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])
const DESTRUCTIVE_METHODS = new Set(['DELETE'])

export const SAFETY_ENV_VARS = {
  dryRun: 'DYNAMIC_OPENAPI_DRY_RUN',
  noDestructive: 'DYNAMIC_OPENAPI_NO_DESTRUCTIVE',
} as const

export class SafetyError extends Error {
  constructor(
    message: string,
    readonly operationId: string,
    readonly sideEffect: SideEffect,
    readonly reason: 'no-consent' | 'floor-blocked',
  ) {
    super(message)
    this.name = 'SafetyError'
  }
}

/**
 * Classify the side-effect of an operation. HTTP method is the baseline.
 * Vendor extensions override:
 *   x-side-effect: 'read-only' | 'write' | 'destructive'
 *   x-destructive: true (sugar for x-side-effect: 'destructive')
 *
 * The extension can sit on the ParsedOperation itself (parser-exposed) or on a
 * `.extensions` record. Both shapes are supported defensively because the
 * upstream parser does not type-export extensions on every release.
 */
export function classifySideEffect(operation: ParsedOperation): SideEffect {
  const override = readSideEffectExtension(operation)
  if (override) return override

  const method = operation.method.toUpperCase()
  if (READ_ONLY_METHODS.has(method)) return 'read-only'
  if (DESTRUCTIVE_METHODS.has(method)) return 'destructive'
  return 'write'
}

function readSideEffectExtension(operation: ParsedOperation): SideEffect | null {
  const bag = operation as unknown as Record<string, unknown>
  const direct = bag['x-side-effect']
  if (typeof direct === 'string' && isSideEffect(direct)) return direct
  if (bag['x-destructive'] === true) return 'destructive'

  const extensions = bag['extensions']
  if (extensions && typeof extensions === 'object') {
    const ext = extensions as Record<string, unknown>
    const fromBag = ext['x-side-effect']
    if (typeof fromBag === 'string' && isSideEffect(fromBag)) return fromBag
    if (ext['x-destructive'] === true) return 'destructive'
  }

  return null
}

function isSideEffect(value: string): value is SideEffect {
  return value === 'read-only' || value === 'write' || value === 'destructive'
}

export function isDryRunFloor(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SAFETY_ENV_VARS.dryRun] === '1'
}

export function isNoDestructiveFloor(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SAFETY_ENV_VARS.noDestructive] === '1'
}
