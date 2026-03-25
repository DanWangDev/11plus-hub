import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { SignupPage } from './SignupPage'

const mockNavigate = vi.fn()

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/api/auth', () => ({
  register: vi.fn(),
  googleAuth: vi.fn(),
}))

vi.mock('@/components/GoogleSignInButton', () => ({
  GoogleSignInButton: () => null,
}))

vi.mock('@/components/TurnstileWidget', () => ({
  TurnstileWidget: () => null,
  isTurnstileEnabled: false,
}))

import { register } from '@/api/auth'
const mockRegister = vi.mocked(register)

describe('SignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders signup form', () => {
    render(<SignupPage />)
    expect(screen.getByRole('heading', { name: 'Create Account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Display Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('shows link to login', () => {
    render(<SignupPage />)
    expect(screen.getByText('Sign in')).toBeInTheDocument()
  })

  it('shows validation errors for empty fields', async () => {
    const user = userEvent.setup()
    render(<SignupPage />)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      expect(alerts.length).toBeGreaterThan(0)
    })
  })

  it('validates username format', async () => {
    const user = userEvent.setup()
    render(<SignupPage />)

    await user.type(screen.getByLabelText('Display Name'), 'Emma')
    await user.type(screen.getByLabelText('Username'), 'a b')
    await user.type(screen.getByLabelText('Email'), 'emma@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(
        screen.getByText('Username can only contain letters, numbers, hyphens, and underscores'),
      ).toBeInTheDocument()
    })
  })

  it('validates password length', async () => {
    const user = userEvent.setup()
    render(<SignupPage />)

    await user.type(screen.getByLabelText('Display Name'), 'Emma')
    await user.type(screen.getByLabelText('Username'), 'emma')
    await user.type(screen.getByLabelText('Email'), 'emma@test.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    })
  })

  it('shows success message after registration', async () => {
    const user = userEvent.setup()
    mockRegister.mockResolvedValueOnce({
      success: true,
      data: {
        id: 1,
        username: 'emma',
        email: 'emma@test.com',
        display_name: 'Emma',
        role: 'student',
        parent_id: null,
        google_id: null,
        email_verified: false,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    })

    render(<SignupPage />)

    await user.type(screen.getByLabelText('Display Name'), 'Emma')
    await user.type(screen.getByLabelText('Username'), 'emma')
    await user.type(screen.getByLabelText('Email'), 'emma@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(screen.getByText(/Account Created/i)).toBeInTheDocument()
    })
  })

  it('shows error on duplicate user', async () => {
    const user = userEvent.setup()
    const { ApiError } = await import('@/lib/api-client')
    mockRegister.mockRejectedValueOnce(new ApiError('User already exists', 409))

    render(<SignupPage />)

    await user.type(screen.getByLabelText('Display Name'), 'Emma')
    await user.type(screen.getByLabelText('Username'), 'emma')
    await user.type(screen.getByLabelText('Email'), 'emma@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(
        screen.getByText('An account with that username or email already exists'),
      ).toBeInTheDocument()
    })
  })
})
