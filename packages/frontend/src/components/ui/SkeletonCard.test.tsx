import { describe, it, expect } from 'vitest'
import { render } from '@/test/test-utils'
import { SkeletonCard } from './SkeletonCard'

describe('SkeletonCard', () => {
  it('renders with aria-hidden', () => {
    const { container } = render(<SkeletonCard />)
    const skeleton = container.firstElementChild
    expect(skeleton).toHaveAttribute('aria-hidden', 'true')
  })

  it('has shimmer animation on placeholder elements', () => {
    const { container } = render(<SkeletonCard />)
    const placeholders = container.querySelectorAll('[class*="shimmer"]')
    expect(placeholders.length).toBeGreaterThan(0)
  })
})
