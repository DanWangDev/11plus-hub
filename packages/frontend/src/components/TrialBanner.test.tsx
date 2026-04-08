import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { TrialBanner } from './TrialBanner'
import type { HubUser } from '@/types/api'

const baseUser: HubUser = {
  sub: '1',
  username: 'parent1',
  display_name: 'Test Parent',
  email: 'parent@example.com',
  email_verified: true,
  role: 'parent',
  plan: 'writing',
  features: ['writing'],
  apps: [],
  has_password: true,
  expires_at: null,
}

let mockUser: HubUser | null = baseUser

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

beforeEach(() => {
  mockUser = baseUser
})

describe('TrialBanner', () => {
  it('does not show for free plan', () => {
    mockUser = { ...baseUser, plan: 'free', expires_at: null }
    const { container } = render(<TrialBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('does not show for paid plan without expiry', () => {
    mockUser = { ...baseUser, plan: 'writing', expires_at: null }
    const { container } = render(<TrialBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('shows days remaining for active trial', () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 10)
    mockUser = { ...baseUser, expires_at: futureDate.toISOString() }

    render(<TrialBanner />)
    expect(screen.getByText(/10 days left in your trial/)).toBeInTheDocument()
    expect(screen.getByText('Upgrade')).toBeInTheDocument()
  })

  it('shows singular day text', () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 1)
    mockUser = { ...baseUser, expires_at: futureDate.toISOString() }

    render(<TrialBanner />)
    expect(screen.getByText(/1 day left in your trial/)).toBeInTheDocument()
  })

  it('shows expired message when trial ended', () => {
    mockUser = { ...baseUser, expires_at: '2020-01-01T00:00:00Z' }

    render(<TrialBanner />)
    expect(screen.getByText('Your trial has ended.')).toBeInTheDocument()
    expect(screen.getByText('Subscribe now')).toBeInTheDocument()
  })

  it('can be dismissed', async () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 5)
    mockUser = { ...baseUser, expires_at: futureDate.toISOString() }

    const user = userEvent.setup()
    render(<TrialBanner />)

    expect(screen.getByText(/5 days left/)).toBeInTheDocument()
    await user.click(screen.getByLabelText('Dismiss trial banner'))
    expect(screen.queryByText(/5 days left/)).not.toBeInTheDocument()
  })

  it('renders nothing when no user', () => {
    mockUser = null
    const { container } = render(<TrialBanner />)
    expect(container.firstChild).toBeNull()
  })
})
