import { describe, it, expect } from 'vitest'
import { relativeTime } from './relativeTime.js'

const now = Date.parse('2026-05-31T12:00:00.000Z')

describe('relativeTime', () => {
  it('reports recent times as "just now"', () => {
    expect(relativeTime('2026-05-31T11:59:40.000Z', now)).toBe('just now')
  })

  it('reports minutes, hours and days', () => {
    expect(relativeTime('2026-05-31T11:30:00.000Z', now)).toBe('30m ago')
    expect(relativeTime('2026-05-31T09:00:00.000Z', now)).toBe('3h ago')
    expect(relativeTime('2026-05-28T12:00:00.000Z', now)).toBe('3d ago')
  })

  it('reports weeks for the recent past', () => {
    expect(relativeTime('2026-05-10T12:00:00.000Z', now)).toBe('3w ago')
  })

  it('falls back to a date for older timestamps', () => {
    expect(relativeTime('2026-01-02T12:00:00.000Z', now)).toMatch(/Jan/)
  })

  it('returns an empty string for unparseable input', () => {
    expect(relativeTime('not-a-date', now)).toBe('')
    expect(relativeTime('', now)).toBe('')
  })
})
