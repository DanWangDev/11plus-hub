import { describe, it, expect } from 'vitest'
import { loginSchema, signupSchema, forgotPasswordSchema, resetPasswordSchema } from './validation'

describe('loginSchema', () => {
  it('accepts valid data', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty email', () => {
    const result = loginSchema.safeParse({ email: '', password: 'pass' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({ email: 'not-email', password: 'pass' })
    expect(result.success).toBe(false)
  })

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({ email: 'test@example.com', password: '' })
    expect(result.success).toBe(false)
  })
})

describe('signupSchema', () => {
  it('accepts valid data', () => {
    const result = signupSchema.safeParse({
      username: 'emma_learns',
      email: 'emma@example.com',
      password: 'password123',
      displayName: 'Emma',
    })
    expect(result.success).toBe(true)
  })

  it('rejects short username', () => {
    const result = signupSchema.safeParse({
      username: 'ab',
      email: 'emma@example.com',
      password: 'password123',
      displayName: 'Emma',
    })
    expect(result.success).toBe(false)
  })

  it('rejects username with spaces', () => {
    const result = signupSchema.safeParse({
      username: 'a b c',
      email: 'emma@example.com',
      password: 'password123',
      displayName: 'Emma',
    })
    expect(result.success).toBe(false)
  })

  it('rejects short password', () => {
    const result = signupSchema.safeParse({
      username: 'emma',
      email: 'emma@example.com',
      password: 'short',
      displayName: 'Emma',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty displayName', () => {
    const result = signupSchema.safeParse({
      username: 'emma',
      email: 'emma@example.com',
      password: 'password123',
      displayName: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('forgotPasswordSchema', () => {
  it('accepts valid email', () => {
    const result = forgotPasswordSchema.safeParse({ email: 'test@example.com' })
    expect(result.success).toBe(true)
  })

  it('rejects empty email', () => {
    const result = forgotPasswordSchema.safeParse({ email: '' })
    expect(result.success).toBe(false)
  })
})

describe('resetPasswordSchema', () => {
  it('accepts matching passwords', () => {
    const result = resetPasswordSchema.safeParse({
      newPassword: 'password123',
      confirmPassword: 'password123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-matching passwords', () => {
    const result = resetPasswordSchema.safeParse({
      newPassword: 'password123',
      confirmPassword: 'password456',
    })
    expect(result.success).toBe(false)
  })

  it('rejects short password', () => {
    const result = resetPasswordSchema.safeParse({
      newPassword: 'short',
      confirmPassword: 'short',
    })
    expect(result.success).toBe(false)
  })
})
