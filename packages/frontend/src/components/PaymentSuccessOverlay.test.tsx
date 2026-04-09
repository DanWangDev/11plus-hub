import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { PaymentSuccessOverlay } from './PaymentSuccessOverlay'

const mockRefresh = vi.fn().mockResolvedValue(undefined)

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({
    user: {
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
    },
    loading: false,
    logout: vi.fn(),
    refresh: mockRefresh,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

beforeEach(() => {
  mockRefresh.mockClear()
})

describe('PaymentSuccessOverlay', () => {
  it('shows overlay when payment=success in URL', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard?payment=success']}>
        <PaymentSuccessOverlay />
      </MemoryRouter>,
    )

    expect(screen.getByText("You're all set!")).toBeInTheDocument()
    expect(screen.getByText(/Writing Buddy is now active/)).toBeInTheDocument()
  })

  it('triggers auth refresh on payment success', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard?payment=success']}>
        <PaymentSuccessOverlay />
      </MemoryRouter>,
    )

    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not show when no payment param', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PaymentSuccessOverlay />
      </MemoryRouter>,
    )

    expect(screen.queryByText("You're all set!")).not.toBeInTheDocument()
  })

  it('dismisses when button clicked', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/dashboard?payment=success']}>
        <PaymentSuccessOverlay />
      </MemoryRouter>,
    )

    expect(screen.getByText("You're all set!")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /go to dashboard/i }))
    expect(screen.queryByText("You're all set!")).not.toBeInTheDocument()
  })
})
