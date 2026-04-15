import { describe, it, expect } from 'vitest'
import { formatRelative, formatAbsolute } from './format-date'

const NOW = new Date('2026-04-15T12:00:00Z')

describe('formatRelative', () => {
  it('returns "Never" for null', () => {
    expect(formatRelative(null, NOW)).toBe('Never')
  })

  it('returns "Never" for undefined', () => {
    expect(formatRelative(undefined, NOW)).toBe('Never')
  })

  it('returns "Never" for invalid date string', () => {
    expect(formatRelative('not-a-date', NOW)).toBe('Never')
  })

  it('returns "just now" for timestamps under 45 seconds old', () => {
    const iso = new Date(NOW.getTime() - 10 * 1000).toISOString()
    expect(formatRelative(iso, NOW)).toBe('just now')
  })

  it('returns "1 min ago" between 45 and 90 seconds', () => {
    const iso = new Date(NOW.getTime() - 60 * 1000).toISOString()
    expect(formatRelative(iso, NOW)).toBe('1 min ago')
  })

  it('returns "N min ago" under an hour', () => {
    const iso = new Date(NOW.getTime() - 15 * 60 * 1000).toISOString()
    expect(formatRelative(iso, NOW)).toBe('15 min ago')
  })

  it('returns "1 hour ago" just over an hour', () => {
    const iso = new Date(NOW.getTime() - 75 * 60 * 1000).toISOString()
    expect(formatRelative(iso, NOW)).toBe('1 hour ago')
  })

  it('returns "N hours ago" under a day', () => {
    const iso = new Date(NOW.getTime() - 5 * 60 * 60 * 1000).toISOString()
    expect(formatRelative(iso, NOW)).toBe('5 hours ago')
  })

  it('returns "yesterday" between 1 and 2 days', () => {
    const iso = new Date(NOW.getTime() - 36 * 60 * 60 * 1000).toISOString()
    expect(formatRelative(iso, NOW)).toBe('yesterday')
  })

  it('returns "N days ago" under a week', () => {
    const iso = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelative(iso, NOW)).toBe('4 days ago')
  })

  it('falls back to absolute format beyond a week', () => {
    const iso = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const result = formatRelative(iso, NOW)
    expect(result).not.toBe('Never')
    expect(result).not.toMatch(/ago$/)
    // Should be a locale date string with the year 2026 or 2025
    expect(result).toMatch(/20(25|26)/)
  })

  it('falls back to absolute format for future dates', () => {
    const iso = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString()
    const result = formatRelative(iso, NOW)
    expect(result).not.toMatch(/ago$/)
    expect(result).not.toBe('Never')
  })
})

describe('formatAbsolute', () => {
  it('returns "Never" for null', () => {
    expect(formatAbsolute(null)).toBe('Never')
  })

  it('returns "Never" for undefined', () => {
    expect(formatAbsolute(undefined)).toBe('Never')
  })

  it('returns "Never" for invalid date string', () => {
    expect(formatAbsolute('not-a-date')).toBe('Never')
  })

  it('returns a non-empty locale string for a valid date', () => {
    const result = formatAbsolute('2026-04-15T12:00:00Z')
    expect(result).not.toBe('Never')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toMatch(/2026/)
  })
})
