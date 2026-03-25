import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Routes, Route, Navigate } from 'react-router'
import { AuthProvider } from '@/contexts/auth-context'
import { LoginPage } from '@/pages/LoginPage'
import { SignupPage } from '@/pages/SignupPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

vi.mock('@/api/auth', () => ({
  login: vi.fn(),
  googleAuth: vi.fn(),
  register: vi.fn(),
}))

vi.mock('@/components/GoogleSignInButton', () => ({
  GoogleSignInButton: () => null,
}))

vi.mock('@/components/TurnstileWidget', () => ({
  TurnstileWidget: () => null,
  isTurnstileEnabled: false,
}))

function TestApp({ initialEntry }: { initialEntry: string }) {
  return (
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )
}

describe('App routing', () => {
  it('redirects / to /login', () => {
    render(<TestApp initialEntry="/" />)
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('renders login page at /login', () => {
    render(<TestApp initialEntry="/login" />)
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('renders signup page at /signup', () => {
    render(<TestApp initialEntry="/signup" />)
    expect(screen.getByRole('heading', { name: 'Create Account' })).toBeInTheDocument()
  })

  it('renders 404 for unknown routes', () => {
    render(<TestApp initialEntry="/unknown" />)
    expect(screen.getByText('Page Not Found')).toBeInTheDocument()
  })
})
