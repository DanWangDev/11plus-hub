import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { UserMenu } from './UserMenu'

// Mock auth context
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

describe('UserMenu', () => {
  it('renders user display name', () => {
    render(<UserMenu onEditProfile={vi.fn()} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('renders initials', () => {
    render(<UserMenu onEditProfile={vi.fn()} />)
    expect(screen.getByText('TU')).toBeInTheDocument()
  })

  it('opens dropdown on click', async () => {
    const user = userEvent.setup()
    render(<UserMenu onEditProfile={vi.fn()} />)
    await user.click(screen.getByLabelText('User menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('Edit profile')).toBeInTheDocument()
    expect(screen.getByText('App dashboard')).toBeInTheDocument()
    expect(screen.getByText('Sign out')).toBeInTheDocument()
  })

  it('calls onEditProfile when Edit profile clicked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<UserMenu onEditProfile={onEdit} />)
    await user.click(screen.getByLabelText('User menu'))
    await user.click(screen.getByText('Edit profile'))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('closes dropdown after selecting an item', async () => {
    const user = userEvent.setup()
    render(<UserMenu onEditProfile={vi.fn()} />)
    await user.click(screen.getByLabelText('User menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(screen.getByText('Edit profile'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes dropdown on Escape key', async () => {
    const user = userEvent.setup()
    render(<UserMenu onEditProfile={vi.fn()} />)
    await user.click(screen.getByLabelText('User menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('has App dashboard link pointing to /dashboard', async () => {
    const user = userEvent.setup()
    render(<UserMenu onEditProfile={vi.fn()} />)
    await user.click(screen.getByLabelText('User menu'))
    const link = screen.getByText('App dashboard').closest('a')
    expect(link).toHaveAttribute('href', '/dashboard')
  })
})
