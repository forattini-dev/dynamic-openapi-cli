import { describe, it, expect } from 'vitest'
import * as pkg from '../src/index.js'

describe('public entry points', () => {
  it('re-exports parser, auth, http, utils, and cli builders', () => {
    expect(typeof pkg.loadSpec).toBe('function')
    expect(typeof pkg.resolveSource).toBe('function')
    expect(typeof pkg.resolveSpec).toBe('function')
    expect(typeof pkg.filterOperations).toBe('function')
    expect(typeof pkg.resolveAuth).toBe('function')
    expect(typeof pkg.executeOperation).toBe('function')
    expect(typeof pkg.resolveBaseUrl).toBe('function')
    expect(typeof pkg.resolveServerUrl).toBe('function')
    expect(typeof pkg.RequestError).toBe('function')
    expect(typeof pkg.ValidationError).toBe('function')
    expect(typeof pkg.fetchWithRetry).toBe('function')
    expect(typeof pkg.buildCommandsFromSpec).toBe('function')
    expect(typeof pkg.buildBundle).toBe('function')
    expect(typeof pkg.buildCli).toBe('function')
    expect(typeof pkg.runCli).toBe('function')
  })
})
