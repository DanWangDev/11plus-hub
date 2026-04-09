import { describe, it, expect, vi } from 'vitest'
import { loginLimiter, registerLimiter, passwordResetLimiter, apiLimiter } from './rate-limit.js'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('rate-limit middleware', () => {
  it('exports loginLimiter as a function', () => {
    expect(typeof loginLimiter).toBe('function')
  })

  it('exports registerLimiter as a function', () => {
    expect(typeof registerLimiter).toBe('function')
  })

  it('exports passwordResetLimiter as a function', () => {
    expect(typeof passwordResetLimiter).toBe('function')
  })

  it('exports apiLimiter as a function', () => {
    expect(typeof apiLimiter).toBe('function')
  })
})
