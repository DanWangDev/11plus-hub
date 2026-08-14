import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { LoginPage } from './LoginPage'
import type * as AuthContext from '@/contexts/auth-context'

const mockNavigate = vi.fn()

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
}))

vi.mock('@/contexts/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthContext>()
  return { ...actual, useAuth: () => mockUseAuth() }
})

const locationMock = {
  href: '',
  search: '',
} as unknown as Location

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    locationMock.href = ''
    locationMock.search = ''
    vi.stubGlobal('location', locationMock)
    mockUseAuth.mockReturnValue({ user: null, loading: false })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a redirecting state while auth is loading', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true })

    render(<LoginPage />)

    expect(screen.getByRole('heading', { name: 'Redirecting...' })).toBeInTheDocument()
    expect(locationMock.href).toBe('')
  })

  it('redirects unauthenticated users to the OIDC login flow', () => {
    render(<LoginPage />)

    expect(locationMock.href).toBe('/api/auth/hub-login?returnTo=%2Fdashboard')
  })

  it('preserves the returnTo query param', () => {
    locationMock.search = '?returnTo=/pricing'

    render(<LoginPage />)

    expect(locationMock.href).toBe('/api/auth/hub-login?returnTo=%2Fpricing')
  })

  it('navigates authenticated students to the dashboard', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'student', username: 'emma' },
      loading: false,
    })

    render(<LoginPage />)

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
    expect(locationMock.href).toBe('')
  })

  it('navigates authenticated admins to the admin panel', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'admin', username: 'admin' },
      loading: false,
    })

    render(<LoginPage />)

    expect(mockNavigate).toHaveBeenCalledWith('/admin', { replace: true })
  })
})
