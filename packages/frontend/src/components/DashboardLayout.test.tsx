import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { DashboardLayout } from './DashboardLayout'

describe('DashboardLayout', () => {
  it('renders children', () => {
    render(<DashboardLayout>Dashboard content</DashboardLayout>)
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })

  it('shows userName', () => {
    render(<DashboardLayout userName="Emma">Content</DashboardLayout>)
    expect(screen.getByText('Emma')).toBeInTheDocument()
  })

  it('defaults userName to User', () => {
    render(<DashboardLayout>Content</DashboardLayout>)
    expect(screen.getAllByText('User').length).toBeGreaterThan(0)
  })

  it('renders skip-to-content link', () => {
    render(<DashboardLayout>Content</DashboardLayout>)
    expect(screen.getByText('Skip to content')).toBeInTheDocument()
  })

  it('renders sign out button', () => {
    render(<DashboardLayout>Content</DashboardLayout>)
    expect(screen.getByLabelText('Sign out')).toBeInTheDocument()
  })

  it('toggles mobile menu', async () => {
    const user = userEvent.setup()
    render(<DashboardLayout>Content</DashboardLayout>)
    const menuButton = screen.getByLabelText('Open menu')
    await user.click(menuButton)
    expect(screen.getByLabelText('Close menu')).toBeInTheDocument()
  })
})
