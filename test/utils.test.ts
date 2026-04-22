import { describe, it, expect } from 'vitest'
import { sanitizeToolName, truncateDescription } from '../src/utils/naming.js'

describe('sanitizeToolName', () => {
  it('replaces non-alphanumeric characters with underscores', () => {
    expect(sanitizeToolName('get pet/by id')).toBe('get_pet_by_id')
  })

  it('collapses repeated underscores and trims edges', () => {
    expect(sanitizeToolName('__a__b__')).toBe('a_b')
  })

  it('truncates to 64 chars', () => {
    expect(sanitizeToolName('a'.repeat(200)).length).toBeLessThanOrEqual(64)
  })
})

describe('truncateDescription', () => {
  it('returns an empty string for undefined input', () => {
    expect(truncateDescription(undefined)).toBe('')
  })

  it('returns the input when shorter than the max', () => {
    expect(truncateDescription('short', 100)).toBe('short')
  })

  it('appends an ellipsis when truncating', () => {
    const text = 'x'.repeat(100)
    expect(truncateDescription(text, 10)).toBe('xxxxxxx...')
  })
})
