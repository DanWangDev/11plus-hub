import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { ProfileCard } from './ProfileCard'

// Mock auth context to provide a user
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({
    user: {
      sub: '1',
      username: 'testuser',
      display_name: 'Test User',
      email: 'test@example.com',
      email_verified: true,
      role: 'student',
      plan: 'free',
      features: [],
      apps: [],
      has_password: true,
      expires_at: null,
    },
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

describe('ProfileCard', () => {
  it('renders user display name', () => {
    render(<ProfileCard onEditClick={vi.fn()} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('renders user email', () => {
    render(<ProfileCard onEditClick={vi.fn()} />)
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
  })

  it('renders role badge', () => {
    render(<ProfileCard onEditClick={vi.fn()} />)
    expect(screen.getByText('student')).toBeInTheDocument()
  })

  it('renders initials from display name', () => {
    render(<ProfileCard onEditClick={vi.fn()} />)
    expect(screen.getByText('TU')).toBeInTheDocument()
  })

  it('calls onEditClick when settings button clicked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<ProfileCard onEditClick={onEdit} />)
    await user.click(screen.getByLabelText('Edit profile'))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
