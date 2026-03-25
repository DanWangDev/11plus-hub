import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { ForgotPasswordPage } from './ForgotPasswordPage'

vi.mock('@/api/password-reset', () => ({
  forgotPassword: vi.fn(),
}))

import { forgotPassword } from '@/api/password-reset'
const mockForgotPassword = vi.mocked(forgotPassword)

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders form', () => {
    render(<ForgotPasswordPage />)
    expect(screen.getByRole('heading', { name: 'Forgot password?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument()
  })

  it('shows link back to login', () => {
    render(<ForgotPasswordPage />)
    expect(screen.getByText('Back to sign in')).toBeInTheDocument()
  })

  it('validates email is required', async () => {
    const user = userEvent.setup()
    render(<ForgotPasswordPage />)

    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('shows success message after submission', async () => {
    const user = userEvent.setup()
    mockForgotPassword.mockResolvedValueOnce({
      success: true,
      data: { message: 'If an account exists with that email, a reset link has been sent' },
    })

    render(<ForgotPasswordPage />)

    await user.type(screen.getByLabelText('Email'), 'emma@test.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() => {
      expect(screen.getByText('Check your email')).toBeInTheDocument()
    })
  })
})
