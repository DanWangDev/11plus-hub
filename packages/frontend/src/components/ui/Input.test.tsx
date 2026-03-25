import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { Input } from './Input'

describe('Input', () => {
  it('renders with label', () => {
    render(<Input label="Email" />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('generates id from label when not provided', () => {
    render(<Input label="Display Name" />)
    const input = screen.getByLabelText('Display Name')
    expect(input).toHaveAttribute('id', 'display-name')
  })

  it('uses provided id', () => {
    render(<Input label="Email" id="custom-email" />)
    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('id', 'custom-email')
  })

  it('shows error message when error prop is set', () => {
    render(<Input label="Email" error="Email is required" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Email is required')
  })

  it('sets aria-invalid when error is present', () => {
    render(<Input label="Email" error="Required" />)
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('does not set aria-invalid when no error', () => {
    render(<Input label="Email" />)
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid')
  })

  it('handles user input', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input label="Email" onChange={onChange} />)
    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    expect(onChange).toHaveBeenCalled()
  })
})
