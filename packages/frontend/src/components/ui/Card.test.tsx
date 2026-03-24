import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { Card } from './Card'

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>)
    expect(screen.getByText('Card content')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<Card className="p-8">Content</Card>)
    expect(screen.getByText('Content').className).toContain('p-8')
  })
})
