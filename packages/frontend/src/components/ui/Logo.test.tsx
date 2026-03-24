import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { Logo } from './Logo'

describe('Logo', () => {
  it('renders Lab F text', () => {
    render(<Logo />)
    expect(screen.getByText('Lab F')).toBeInTheDocument()
  })

  it('renders the F icon', () => {
    render(<Logo />)
    expect(screen.getByText('F')).toBeInTheDocument()
  })
})
