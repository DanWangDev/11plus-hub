import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal'

// Mock HTMLDialogElement methods
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
})

describe('Modal', () => {
  it('renders title and children when open', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Test Modal">
        <p>Modal content</p>
      </Modal>,
    )
    expect(screen.getByText('Test Modal')).toBeInTheDocument()
    expect(screen.getByText('Modal content')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Test Modal">
        <p>Modal content</p>
      </Modal>,
    )
    expect(screen.queryByText('Test Modal')).not.toBeInTheDocument()
  })

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose} title="Test Modal">
        <p>Content</p>
      </Modal>,
    )
    await user.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders dialog element', () => {
    const { container } = render(
      <Modal open={true} onClose={vi.fn()} title="Test Modal">
        <p>Content</p>
      </Modal>,
    )
    expect(container.querySelector('dialog')).toBeInTheDocument()
  })
})
