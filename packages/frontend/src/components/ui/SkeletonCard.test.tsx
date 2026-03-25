import { describe, it, expect } from 'vitest'
import { render } from '@/test/test-utils'
import { SkeletonCard } from './SkeletonCard'

describe('SkeletonCard', () => {
  it('renders with aria-hidden', () => {
    const { container } = render(<SkeletonCard />)
    const skeleton = container.firstElementChild
    expect(skeleton).toHaveAttribute('aria-hidden', 'true')
  })

  it('has animate-pulse class', () => {
    const { container } = render(<SkeletonCard />)
    expect(container.firstElementChild?.className).toContain('animate-pulse')
  })
})
