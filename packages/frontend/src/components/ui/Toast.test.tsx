import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContainer, type ToastMessage } from './Toast'

describe('ToastContainer', () => {
  const messages: ToastMessage[] = [
    { id: '1', variant: 'success', text: 'Profile updated' },
    { id: '2', variant: 'error', text: 'Something went wrong' },
  ]

  it('renders all toast messages', () => {
    render(<ToastContainer messages={messages} onDismiss={vi.fn()} />)
    expect(screen.getByText('Profile updated')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders nothing when no messages', () => {
    const { container } = render(<ToastContainer messages={[]} onDismiss={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('calls onDismiss when dismiss button clicked', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<ToastContainer messages={[messages[0]!]} onDismiss={onDismiss} />)
    await user.click(screen.getByLabelText('Dismiss'))
    expect(onDismiss).toHaveBeenCalledWith('1')
  })

  it('has accessible alert role', () => {
    render(<ToastContainer messages={[messages[0]!]} onDismiss={vi.fn()} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
