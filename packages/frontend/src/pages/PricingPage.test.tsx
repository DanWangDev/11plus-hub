import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { PricingPage } from './PricingPage'
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

let mockUser: HubUser | null = null

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
  mockUser = null
  mockFetch.mockReset()
})

describe('PricingPage', () => {
  it('renders pricing heading', () => {
    render(<PricingPage />)
    expect(screen.getByText('Simple, transparent pricing')).toBeInTheDocument()
  })

  it('shows both plan cards', () => {
    render(<PricingPage />)
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Writing Buddy')).toBeInTheDocument()
  })

  it('shows Popular badge on writing plan', () => {
    render(<PricingPage />)
    expect(screen.getByText('Popular')).toBeInTheDocument()
  })

  describe('logged out', () => {
    it('shows sign in link', () => {
      render(<PricingPage />)
      expect(screen.getByText('Sign in')).toBeInTheDocument()
    })

    it('shows signup buttons', () => {
      render(<PricingPage />)
      expect(screen.getByText('Sign up free')).toBeInTheDocument()
      expect(screen.getByText('Sign up to get started')).toBeInTheDocument()
    })
  })

  describe('logged in, free plan', () => {
    beforeEach(() => {
      mockUser = baseUser
    })

    it('shows Current plan on free tier', () => {
      render(<PricingPage />)
      expect(screen.getByText('Current plan')).toBeInTheDocument()
    })

    it('shows Get Writing Buddy CTA', () => {
      render(<PricingPage />)
      expect(screen.getByRole('button', { name: /get writing buddy/i })).toBeInTheDocument()
    })

    it('calls checkout API on CTA click', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ success: true, data: { url: 'https://checkout.stripe.com/test' } }),
      })

      const user = userEvent.setup()
      render(<PricingPage />)
      await user.click(screen.getByRole('button', { name: /get writing buddy/i }))

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stripe/checkout',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('logged in, paid plan', () => {
    beforeEach(() => {
      mockUser = { ...baseUser, plan: 'writing', features: ['writing'] }
    })

    it('shows Current plan on writing tier', () => {
      render(<PricingPage />)
      const currentPlanButtons = screen.getAllByText('Current plan')
      expect(currentPlanButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('shows Back to Dashboard link', () => {
      render(<PricingPage />)
      expect(screen.getByText('Back to Dashboard')).toBeInTheDocument()
    })
  })
})
