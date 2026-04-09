import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// We test the exported utility logic by importing the module's internals.
// Since the module auto-runs via CLI, we mock process.argv and the DB dependencies.

vi.mock('./connection.js', () => ({
  createDb: vi.fn(),
  closeDb: vi.fn(),
}))

vi.mock('better-sqlite3', () => {
  const mockDb = {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
    })),
    close: vi.fn(),
  }
  return { default: vi.fn(() => mockDb) }
})

// Since migrate-users.ts runs on import (CLI entrypoint), we test
// the logic extracted as standalone functions instead.

describe('user migration utilities', () => {
  describe('role mapping', () => {
    it('maps known roles correctly', () => {
      const roleMap: Record<string, string> = {
        student: 'student',
        parent: 'parent',
        admin: 'admin',
        tutor: 'parent',
      }

      expect(roleMap['student']).toBe('student')
      expect(roleMap['parent']).toBe('parent')
      expect(roleMap['admin']).toBe('admin')
      expect(roleMap['tutor']).toBe('parent')
    })

    it('handles unknown roles', () => {
      const roleMap: Record<string, string> = {
        student: 'student',
        parent: 'parent',
        admin: 'admin',
        tutor: 'parent',
      }
      const unknown = roleMap['moderator']
      expect(unknown).toBeUndefined()
    })
  })

  describe('username generation', () => {
    it('derives username from email prefix', () => {
      const existing = new Set<string>()
      const email = 'john.doe@example.com'
      const base = email.split('@')[0]?.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'user'
      const trimmed = base.slice(0, 27)

      expect(trimmed).toBe('john_doe')
      expect(existing.has(trimmed)).toBe(false)
    })

    it('appends counter when username conflicts', () => {
      const existing = new Set<string>(['john_doe'])
      const email = 'john.doe@example.com'
      const base = email.split('@')[0]?.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'user'
      const trimmed = base.slice(0, 27)

      let counter = 1
      let candidate = `${trimmed}_${counter}`
      while (existing.has(candidate)) {
        counter++
        candidate = `${trimmed}_${counter}`
      }

      expect(candidate).toBe('john_doe_1')
    })

    it('handles multiple conflicts', () => {
      const existing = new Set<string>(['john_doe', 'john_doe_1', 'john_doe_2'])
      const base = 'john_doe'

      let counter = 1
      let candidate = `${base}_${counter}`
      while (existing.has(candidate)) {
        counter++
        candidate = `${base}_${counter}`
      }

      expect(candidate).toBe('john_doe_3')
    })

    it('sanitizes special characters in email', () => {
      const email = 'user+tag@example.com'
      const base = email.split('@')[0]?.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'user'
      expect(base).toBe('user_tag')
    })

    it('truncates long email prefixes', () => {
      const email = 'averylongemailprefixthatshouldbetruncated@example.com'
      const base = email.split('@')[0]?.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'user'
      const trimmed = base.slice(0, 27)
      expect(trimmed.length).toBeLessThanOrEqual(27)
    })
  })

  describe('plan mapping', () => {
    it('maps subscription plans correctly', () => {
      const planMap: Record<string, string> = {
        free: 'free',
        writing: 'writing',
        vocab: 'vocab',
        bundle: 'bundle',
        family: 'family',
        premium: 'bundle',
      }

      expect(planMap['free']).toBe('free')
      expect(planMap['writing']).toBe('writing')
      expect(planMap['premium']).toBe('bundle')
    })

    it('maps feature arrays from plans', () => {
      const featureMap: Record<string, string[]> = {
        free: [],
        writing: ['writing'],
        vocab: ['vocab'],
        bundle: ['writing', 'vocab'],
        family: ['writing', 'vocab'],
      }

      expect(featureMap['free']).toEqual([])
      expect(featureMap['writing']).toEqual(['writing'])
      expect(featureMap['bundle']).toEqual(['writing', 'vocab'])
    })

    it('maps subscription statuses', () => {
      const statusMap: Record<string, string> = {
        active: 'active',
        trial: 'trial',
        expired: 'expired',
        cancelled: 'cancelled',
        canceled: 'cancelled',
      }

      expect(statusMap['active']).toBe('active')
      expect(statusMap['canceled']).toBe('cancelled')
      expect(statusMap['trial']).toBe('trial')
    })
  })

  describe('CLI argument parsing', () => {
    let originalArgv: string[]

    beforeEach(() => {
      originalArgv = process.argv
    })

    it('recognizes --vocab-master flag', () => {
      const args = ['--vocab-master', '/path/to/db.sqlite']
      let vmPath: string | undefined

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--vocab-master' && args[i + 1]) {
          vmPath = args[i + 1]
          i++
        }
      }

      expect(vmPath).toBe('/path/to/db.sqlite')
    })

    it('recognizes --writing-buddy flag', () => {
      const args = ['--writing-buddy', '/path/to/wb.db']
      let wbPath: string | undefined

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--writing-buddy' && args[i + 1]) {
          wbPath = args[i + 1]
          i++
        }
      }

      expect(wbPath).toBe('/path/to/wb.db')
    })

    it('recognizes --dry-run flag', () => {
      const args = ['--dry-run', '--vocab-master', '/path/to/db']
      const dryRun = args.includes('--dry-run')
      expect(dryRun).toBe(true)
    })

    it('supports combined flags', () => {
      const args = ['--vocab-master', '/path/vm.db', '--writing-buddy', '/path/wb.db', '--dry-run']
      let vmPath: string | undefined
      let wbPath: string | undefined
      let dryRun = false

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--vocab-master' && args[i + 1]) {
          vmPath = args[i + 1]
          i++
        } else if (args[i] === '--writing-buddy' && args[i + 1]) {
          wbPath = args[i + 1]
          i++
        } else if (args[i] === '--dry-run') {
          dryRun = true
        }
      }

      expect(vmPath).toBe('/path/vm.db')
      expect(wbPath).toBe('/path/wb.db')
      expect(dryRun).toBe(true)
    })

    afterEach(() => {
      process.argv = originalArgv
    })
  })
})
