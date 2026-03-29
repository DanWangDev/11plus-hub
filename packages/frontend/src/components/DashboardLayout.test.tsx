import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { DashboardLayout } from './DashboardLayout'

describe('DashboardLayout', () => {
  it('renders children', () => {
    render(<DashboardLayout>Dashboard content</DashboardLayout>)
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })

  it('renders skip-to-content link', () => {
    render(<DashboardLayout>Content</DashboardLayout>)
    expect(screen.getByText('Skip to content')).toBeInTheDocument()
  })

  it('renders user menu button', () => {
    render(<DashboardLayout>Content</DashboardLayout>)
    expect(screen.getByLabelText('User menu')).toBeInTheDocument()
  })

  it('renders logo linking to dashboard', () => {
    render(<DashboardLayout>Content</DashboardLayout>)
    expect(screen.getByLabelText('Go to dashboard')).toBeInTheDocument()
  })
})
