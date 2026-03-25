import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { ResetPasswordPage } from './ResetPasswordPage'

vi.mock('@/api/password-reset', () => ({
  resetPassword: vi.fn(),
}))

import { resetPassword } from '@/api/password-reset'
const mockResetPassword = vi.mocked(resetPassword)

// Control searchParams via mock
let mockSearchParams = new URLSearchParams()

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useSearchParams: () => [mockSearchParams],
  }
})

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams({
      selector: 'test-selector',
      validator: 'test-validator',
    })
  })

  it('renders reset form when tokens are present', () => {
    render(<ResetPasswordPage />)
    expect(screen.getByRole('heading', { name: 'Reset Password' })).toBeInTheDocument()
    expect(screen.getByLabelText('New Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument()
  })

  it('shows invalid link message when tokens are missing', () => {
    mockSearchParams = new URLSearchParams()
    render(<ResetPasswordPage />)
    expect(screen.getByText('Invalid Link')).toBeInTheDocument()
    expect(screen.getByText(/password reset link is invalid/i)).toBeInTheDocument()
  })

  it('validates password minimum length', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    await user.type(screen.getByLabelText('New Password'), 'short')
    await user.type(screen.getByLabelText('Confirm Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    })
  })

  it('validates passwords match', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    await user.type(screen.getByLabelText('New Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'password456')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    })
  })

  it('shows success message after reset', async () => {
    const user = userEvent.setup()
    mockResetPassword.mockResolvedValueOnce({
      success: true,
      data: { message: 'Password has been reset successfully' },
    })

    render(<ResetPasswordPage />)

    await user.type(screen.getByLabelText('New Password'), 'newpassword123')
    await user.type(screen.getByLabelText('Confirm Password'), 'newpassword123')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => {
      expect(screen.getByText(/password has been reset successfully/i)).toBeInTheDocument()
    })
  })

  it('calls API with correct params', async () => {
    const user = userEvent.setup()
    mockResetPassword.mockResolvedValueOnce({
      success: true,
      data: { message: 'Done' },
    })

    render(<ResetPasswordPage />)

    await user.type(screen.getByLabelText('New Password'), 'newpassword123')
    await user.type(screen.getByLabelText('Confirm Password'), 'newpassword123')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({
        selector: 'test-selector',
        validator: 'test-validator',
        newPassword: 'newpassword123',
      })
    })
  })
})
