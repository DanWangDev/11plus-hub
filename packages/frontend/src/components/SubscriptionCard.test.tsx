import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { SubscriptionCard } from './SubscriptionCard'
import type { HubUser } from '@/types/api'

const baseUser: HubUser = {
  sub: '1',
  username: 'parent1',
  display_name: 'Test Parent',
  email: 'parent@example.com',
  email_verified: true,
  role: 'parent',
  plan: 'free',
  features: [],
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

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockUser = baseUser
  mockFetch.mockReset()
})

describe('SubscriptionCard', () => {
  describe('free plan', () => {
    it('shows Free plan label', () => {
      render(<SubscriptionCard />)
      expect(screen.getByText('Free')).toBeInTheDocument()
    })

    it('shows Free Plan badge', () => {
      render(<SubscriptionCard />)
      expect(screen.getByText('Free Plan')).toBeInTheDocument()
    })

    it('shows upgrade prompt', () => {
      render(<SubscriptionCard />)
      expect(screen.getByText('Upgrade to unlock Writing Buddy')).toBeInTheDocument()
    })

    it('renders Upgrade button', () => {
      render(<SubscriptionCard />)
      expect(screen.getByRole('button', { name: /upgrade/i })).toBeInTheDocument()
    })

    it('calls checkout API on upgrade click', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ success: true, data: { url: 'https://checkout.stripe.com/test' } }),
      })

      const user = userEvent.setup()
      render(<SubscriptionCard />)
      await user.click(screen.getByRole('button', { name: /upgrade/i }))

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stripe/checkout',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('paid plan', () => {
    beforeEach(() => {
      mockUser = {
        ...baseUser,
        plan: 'writing',
        features: ['writing'],
      }
    })

    it('shows Writing Buddy plan label', () => {
      render(<SubscriptionCard />)
      expect(screen.getByText('Writing Buddy')).toBeInTheDocument()
    })

    it('shows Active badge', () => {
      render(<SubscriptionCard />)
      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('shows features list', () => {
      render(<SubscriptionCard />)
      expect(screen.getByText('writing')).toBeInTheDocument()
    })

    it('renders Manage button instead of Upgrade', () => {
      render(<SubscriptionCard />)
      expect(screen.getByRole('button', { name: /manage/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
    })

    it('calls portal API on manage click', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ success: true, data: { url: 'https://billing.stripe.com/test' } }),
      })

      const user = userEvent.setup()
      render(<SubscriptionCard />)
      await user.click(screen.getByRole('button', { name: /manage/i }))

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stripe/portal',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('expired plan', () => {
    it('shows Cancelled badge when expires_at is in the past', () => {
      mockUser = {
        ...baseUser,
        plan: 'writing',
        features: ['writing'],
        expires_at: '2020-01-01T00:00:00Z',
      }

      render(<SubscriptionCard />)
      expect(screen.getByText('Cancelled')).toBeInTheDocument()
    })
  })

  it('renders nothing when no user', () => {
    mockUser = null
    const { container } = render(<SubscriptionCard />)
    expect(container.firstChild).toBeNull()
  })
})
