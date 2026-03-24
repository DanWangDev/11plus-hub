import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { NotFoundPage } from './NotFoundPage'

describe('NotFoundPage', () => {
  it('renders 404 page', () => {
    render(<NotFoundPage />)
    expect(screen.getByText('Page Not Found')).toBeInTheDocument()
  })

  it('shows link to sign in', () => {
    render(<NotFoundPage />)
    expect(screen.getByRole('button', { name: 'Go to sign in' })).toBeInTheDocument()
  })
})
