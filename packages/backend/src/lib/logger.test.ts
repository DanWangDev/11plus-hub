import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger } from './logger.js'

describe('createLogger', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    writeSpy.mockRestore()
  })

  it('logs info messages with correct structure', () => {
    const logger = createLogger()
    logger.info('test message')

    expect(writeSpy).toHaveBeenCalledOnce()
    const output = JSON.parse((writeSpy.mock.calls[0]![0] as string).trim())
    expect(output).toMatchObject({
      level: 'info',
      message: 'test message',
    })
    expect(output.ts).toBeDefined()
  })

  it('logs warn messages', () => {
    const logger = createLogger()
    logger.warn('warning')

    const output = JSON.parse((writeSpy.mock.calls[0]![0] as string).trim())
    expect(output.level).toBe('warn')
    expect(output.message).toBe('warning')
  })

  it('logs error messages', () => {
    const logger = createLogger()
    logger.error('something failed')

    const output = JSON.parse((writeSpy.mock.calls[0]![0] as string).trim())
    expect(output.level).toBe('error')
    expect(output.message).toBe('something failed')
  })

  it('includes context in all log entries', () => {
    const logger = createLogger({ service: 'user-service', requestId: 'abc-123' })
    logger.info('test')

    const output = JSON.parse((writeSpy.mock.calls[0]![0] as string).trim())
    expect(output.service).toBe('user-service')
    expect(output.requestId).toBe('abc-123')
  })

  it('merges additional data into log entry', () => {
    const logger = createLogger({ service: 'auth' })
    logger.info('user logged in', { userId: 42, duration: 150 })

    const output = JSON.parse((writeSpy.mock.calls[0]![0] as string).trim())
    expect(output.service).toBe('auth')
    expect(output.userId).toBe(42)
    expect(output.duration).toBe(150)
  })

  it('data overrides context for same keys', () => {
    const logger = createLogger({ operation: 'default' })
    logger.info('test', { operation: 'specific' })

    const output = JSON.parse((writeSpy.mock.calls[0]![0] as string).trim())
    expect(output.operation).toBe('specific')
  })

  it('outputs valid JSON terminated with newline', () => {
    const logger = createLogger()
    logger.info('test')

    const raw = writeSpy.mock.calls[0]![0] as string
    expect(raw.endsWith('\n')).toBe(true)
    expect(() => JSON.parse(raw.trim())).not.toThrow()
  })
})
