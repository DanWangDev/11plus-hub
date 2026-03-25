import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { AuthLayout } from './AuthLayout'

describe('AuthLayout', () => {
  it('renders title', () => {
    render(<AuthLayout title="Sign In">Content</AuthLayout>)
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('renders subtitle when provided', () => {
    render(
      <AuthLayout title="Sign In" subtitle="Welcome back">
        Content
      </AuthLayout>,
    )
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(<AuthLayout title="Test">Hello world</AuthLayout>)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders skip-to-content link', () => {
    render(<AuthLayout title="Test">Content</AuthLayout>)
    expect(screen.getByText('Skip to content')).toBeInTheDocument()
  })

  it('renders Lab F logo', () => {
    render(<AuthLayout title="Test">Content</AuthLayout>)
    expect(screen.getByText('Lab F')).toBeInTheDocument()
  })
})
