import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { LoginPage } from './LoginPage'

const mockNavigate = vi.fn()

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/api/auth', () => ({
  login: vi.fn(),
}))

import { login } from '@/api/auth'
const mockLogin = vi.mocked(login)

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders login form', () => {
    render(<LoginPage />)
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows links to forgot password and signup', () => {
    render(<LoginPage />)
    expect(screen.getByText('Forgot password?')).toBeInTheDocument()
    expect(screen.getByText('Create account')).toBeInTheDocument()
  })

  it('shows validation errors for empty fields', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      expect(alerts.length).toBeGreaterThan(0)
    })
  })

  it('shows validation error for invalid email', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)

    await user.type(screen.getByLabelText('Email'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(screen.getByText('Please enter a valid email')).toBeInTheDocument()
    })
  })

  it('calls login API and navigates on success', async () => {
    const user = userEvent.setup()
    mockLogin.mockResolvedValueOnce({
      success: true,
      data: {
        user: {
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
        token: 'jwt-token',
      },
    })

    render(<LoginPage />)

    await user.type(screen.getByLabelText('Email'), 'emma@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'emma@test.com',
        password: 'password123',
      })
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('shows error message on login failure', async () => {
    const user = userEvent.setup()
    const { ApiError } = await import('@/lib/api-client')
    mockLogin.mockRejectedValueOnce(new ApiError('Invalid credentials', 401))

    render(<LoginPage />)

    await user.type(screen.getByLabelText('Email'), 'emma@test.com')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(screen.getByText('Invalid email or password')).toBeInTheDocument()
    })
  })
})
