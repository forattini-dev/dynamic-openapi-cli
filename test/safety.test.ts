import { describe, it, expect } from 'vitest'
import type { ParsedOperation } from 'dynamic-openapi-tools/parser'
import {
  classifySideEffect,
  isDryRunFloor,
  isNoDestructiveFloor,
  SafetyError,
} from '../src/http/safety.js'

function op(overrides: Partial<ParsedOperation> & Record<string, unknown> = {}): ParsedOperation {
  return {
    operationId: 'doThing',
    path: '/things',
    method: 'GET',
    tags: [],
    parameters: [],
    responses: {},
    security: [],
    ...overrides,
  } as ParsedOperation
}

describe('classifySideEffect — HTTP method baseline', () => {
  it.each([
    ['GET', 'read-only'],
    ['HEAD', 'read-only'],
    ['OPTIONS', 'read-only'],
    ['TRACE', 'read-only'],
    ['POST', 'write'],
    ['PUT', 'write'],
    ['PATCH', 'write'],
    ['DELETE', 'destructive'],
  ] as const)('classifies %s as %s', (method, expected) => {
    expect(classifySideEffect(op({ method }))).toBe(expected)
  })
})

describe('classifySideEffect — vendor extensions override the method baseline', () => {
  it('x-side-effect: destructive escalates a GET', () => {
    expect(classifySideEffect(op({ method: 'GET', 'x-side-effect': 'destructive' }))).toBe('destructive')
  })

  it('x-side-effect: read-only de-escalates a POST', () => {
    expect(classifySideEffect(op({ method: 'POST', 'x-side-effect': 'read-only' }))).toBe('read-only')
  })

  it('x-destructive: true is sugar for destructive', () => {
    expect(classifySideEffect(op({ method: 'GET', 'x-destructive': true }))).toBe('destructive')
  })

  it('reads the same extensions from a nested extensions bag', () => {
    expect(
      classifySideEffect(op({ method: 'GET', extensions: { 'x-side-effect': 'destructive' } }))
    ).toBe('destructive')
  })

  it('ignores an unknown x-side-effect value', () => {
    expect(classifySideEffect(op({ method: 'POST', 'x-side-effect': 'banana' }))).toBe('write')
  })
})

describe('env-var floors', () => {
  it('isDryRunFloor reads DYNAMIC_OPENAPI_DRY_RUN === "1"', () => {
    expect(isDryRunFloor({ DYNAMIC_OPENAPI_DRY_RUN: '1' })).toBe(true)
    expect(isDryRunFloor({ DYNAMIC_OPENAPI_DRY_RUN: 'true' })).toBe(false)
    expect(isDryRunFloor({})).toBe(false)
  })

  it('isNoDestructiveFloor reads DYNAMIC_OPENAPI_NO_DESTRUCTIVE === "1"', () => {
    expect(isNoDestructiveFloor({ DYNAMIC_OPENAPI_NO_DESTRUCTIVE: '1' })).toBe(true)
    expect(isNoDestructiveFloor({ DYNAMIC_OPENAPI_NO_DESTRUCTIVE: '0' })).toBe(false)
    expect(isNoDestructiveFloor({})).toBe(false)
  })
})

describe('SafetyError', () => {
  it('carries operation, side-effect, and reason fields', () => {
    const err = new SafetyError('blocked', 'deletePet', 'destructive', 'no-consent')
    expect(err.name).toBe('SafetyError')
    expect(err.operationId).toBe('deletePet')
    expect(err.sideEffect).toBe('destructive')
    expect(err.reason).toBe('no-consent')
  })
})
