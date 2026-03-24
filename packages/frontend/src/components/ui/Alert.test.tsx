import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { Alert } from './Alert'

describe('Alert', () => {
  it('renders error variant', () => {
    render(<Alert variant="error">Something went wrong</Alert>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong')
    expect(alert.className).toContain('bg-red-50')
  })

  it('renders success variant', () => {
    render(<Alert variant="success">Done!</Alert>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Done!')
    expect(alert.className).toContain('bg-green-50')
  })

  it('renders info variant', () => {
    render(<Alert variant="info">FYI</Alert>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('FYI')
  })

  it('applies custom className', () => {
    render(<Alert variant="info" className="mt-4">Info</Alert>)
    expect(screen.getByRole('alert').className).toContain('mt-4')
  })
})
