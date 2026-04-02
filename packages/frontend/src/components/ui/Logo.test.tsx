import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { Logo } from './Logo'

describe('Logo', () => {
  it('renders 11+ Hub text', () => {
    render(<Logo />)
    expect(screen.getByText('11+ Hub')).toBeInTheDocument()
  })

  it('renders the 11+ icon', () => {
    render(<Logo />)
    expect(screen.getByText('11+')).toBeInTheDocument()
  })
})
