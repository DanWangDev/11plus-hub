import { describe, it, expect } from 'vitest'

/**
 * Tests for migrate-writing-buddy.ts utility functions.
 * Since the module auto-runs via CLI, we replicate the pure logic here
 * (same pattern as migrate-users.test.ts).
 */

// --- Replicated pure functions (not exported from source) ---

function isDanielUser(user: {
  display_name: string
  email: string
}): boolean {
  const name = (user.display_name ?? '').toLowerCase()
  const email = (user.email ?? '').toLowerCase()
  return name.includes('daniel') || email === 'bigdaddy' || name === 'admin'
}

function mapRole(role: string): string {
  const roleMap: Record<string, string> = {
    student: 'student',
    parent: 'parent',
    admin: 'admin',
    tutor: 'parent',
  }
  return roleMap[role] ?? 'student'
}

function generateUsername(email: string, existing: Set<string>): string {
  const base = email.split('@')[0]?.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'user'
  const trimmed = base.slice(0, 27)
  if (trimmed.length >= 3 && !existing.has(trimmed)) {
    existing.add(trimmed)
    return trimmed
  }
  let counter = 1
  let candidate = `${trimmed}_${counter}`
  while (existing.has(candidate)) {
    counter++
    candidate = `${trimmed}_${counter}`
  }
  existing.add(candidate)
  return candidate
}

// --- Tests ---

describe('migrate-writing-buddy utilities', () => {
  describe('isDanielUser', () => {
    it('returns true when display_name contains "daniel"', () => {
      expect(
        isDanielUser({ display_name: 'Daniel Wang', email: 'dan@example.com' }),
      ).toBe(true)
    })

    it('is case-insensitive for display_name', () => {
      expect(
        isDanielUser({ display_name: 'DANIEL', email: 'other@example.com' }),
      ).toBe(true)
    })

    it('returns true when email is "bigdaddy"', () => {
      expect(
        isDanielUser({ display_name: 'Some User', email: 'BigDaddy' }),
      ).toBe(true)
    })

    it('returns true when display_name is "admin"', () => {
      expect(
        isDanielUser({ display_name: 'Admin', email: 'admin@example.com' }),
      ).toBe(true)
    })

    it('returns false for non-matching user', () => {
      expect(
        isDanielUser({ display_name: 'Jane Doe', email: 'jane@example.com' }),
      ).toBe(false)
    })

    it('handles empty display_name gracefully', () => {
      expect(
        isDanielUser({ display_name: '', email: 'someone@example.com' }),
      ).toBe(false)
    })
  })

  describe('mapRole', () => {
    it('maps student to student', () => {
      expect(mapRole('student')).toBe('student')
    })

    it('maps parent to parent', () => {
      expect(mapRole('parent')).toBe('parent')
    })

    it('maps admin to admin', () => {
      expect(mapRole('admin')).toBe('admin')
    })

    it('maps tutor to parent', () => {
      expect(mapRole('tutor')).toBe('parent')
    })

    it('defaults unknown roles to student', () => {
      expect(mapRole('moderator')).toBe('student')
      expect(mapRole('')).toBe('student')
    })
  })

  describe('generateUsername', () => {
    it('uses email prefix as username', () => {
      const existing = new Set<string>()
      expect(generateUsername('jane@example.com', existing)).toBe('jane')
    })

    it('sanitizes special characters', () => {
      const existing = new Set<string>()
      expect(generateUsername('j.a+n.e@example.com', existing)).toBe('j_a_n_e')
    })

    it('truncates long prefixes to 27 chars', () => {
      const existing = new Set<string>()
      const longEmail = 'a'.repeat(40) + '@example.com'
      const result = generateUsername(longEmail, existing)
      expect(result.length).toBeLessThanOrEqual(27)
    })

    it('appends counter on collision', () => {
      const existing = new Set<string>(['jane'])
      expect(generateUsername('jane@example.com', existing)).toBe('jane_1')
    })

    it('increments counter on multiple collisions', () => {
      const existing = new Set<string>(['jane', 'jane_1', 'jane_2'])
      expect(generateUsername('jane@example.com', existing)).toBe('jane_3')
    })

    it('adds generated username to existing set', () => {
      const existing = new Set<string>()
      generateUsername('bob@example.com', existing)
      expect(existing.has('bob')).toBe(true)
    })

    it('handles short prefix (< 3 chars) by appending counter', () => {
      const existing = new Set<string>()
      expect(generateUsername('ab@example.com', existing)).toBe('ab_1')
    })
  })
})
