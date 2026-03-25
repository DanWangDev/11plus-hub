import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { InteractionPage } from './InteractionPage'

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useParams: () => ({ uid: 'test-uid-123' }),
  }
})

vi.mock('@/api/auth', () => ({
  getInteractionDetails: vi.fn(),
  submitInteractionLogin: vi.fn(),
  submitInteractionConsent: vi.fn(),
  abortInteraction: vi.fn(),
}))

import {
  getInteractionDetails,
  submitInteractionLogin,
  submitInteractionConsent,
  abortInteraction,
} from '@/api/auth'

const mockGetDetails = vi.mocked(getInteractionDetails)
const mockSubmitLogin = vi.mocked(submitInteractionLogin)
const mockSubmitConsent = vi.mocked(submitInteractionConsent)
const mockAbortInteraction = vi.mocked(abortInteraction)

describe('InteractionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    mockGetDetails.mockReturnValue(new Promise(() => {}))
    render(<InteractionPage />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders login form for login interaction', async () => {
    mockGetDetails.mockResolvedValueOnce({
      prompt: { name: 'login' },
      params: { client_id: 'vocab-master' },
      uid: 'test-uid-123',
    })

    render(<InteractionPage />)

    await waitFor(() => {
      expect(screen.getByLabelText('Email or Username')).toBeInTheDocument()
      expect(screen.getByLabelText('Password')).toBeInTheDocument()
    })
  })

  it('renders consent screen for consent interaction', async () => {
    mockGetDetails.mockResolvedValueOnce({
      prompt: { name: 'consent' },
      params: { client_id: 'vocab-master', scope: 'openid profile email' },
      client: { name: 'Vocab Master' },
      uid: 'test-uid-123',
    })

    render(<InteractionPage />)

    await waitFor(() => {
      expect(screen.getByText('Authorize')).toBeInTheDocument()
      expect(screen.getByText('Vocab Master')).toBeInTheDocument()
      expect(screen.getByText('openid')).toBeInTheDocument()
      expect(screen.getByText('profile')).toBeInTheDocument()
      expect(screen.getByText('email')).toBeInTheDocument()
    })
  })

  it('shows error when interaction details fail', async () => {
    mockGetDetails.mockRejectedValueOnce(new Error('Not found'))

    render(<InteractionPage />)

    await waitFor(() => {
      expect(screen.getByText('Not found')).toBeInTheDocument()
    })
  })

  it('submits login form during interaction', async () => {
    const user = userEvent.setup()
    mockGetDetails.mockResolvedValueOnce({
      prompt: { name: 'login' },
      params: { client_id: 'vocab-master' },
      uid: 'test-uid-123',
    })
    mockSubmitLogin.mockResolvedValueOnce({ success: true })

    render(<InteractionPage />)

    await waitFor(() => {
      expect(screen.getByLabelText('Email or Username')).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText('Email or Username'), 'emma@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(mockSubmitLogin).toHaveBeenCalledWith('test-uid-123', {
        identifier: 'emma@test.com',
        password: 'password123',
      })
    })
  })

  it('submits consent confirmation', async () => {
    const user = userEvent.setup()
    mockGetDetails.mockResolvedValueOnce({
      prompt: { name: 'consent' },
      params: { client_id: 'vocab-master', scope: 'openid profile' },
      client: { name: 'Vocab Master' },
      uid: 'test-uid-123',
    })
    mockSubmitConsent.mockResolvedValueOnce({ success: true })

    render(<InteractionPage />)

    await waitFor(() => {
      expect(screen.getByText('Authorize')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Allow' }))

    await waitFor(() => {
      expect(mockSubmitConsent).toHaveBeenCalledWith('test-uid-123')
    })
  })

  it('aborts consent when deny is clicked', async () => {
    const user = userEvent.setup()
    mockGetDetails.mockResolvedValueOnce({
      prompt: { name: 'consent' },
      params: { client_id: 'vocab-master', scope: 'openid' },
      client: { name: 'Vocab Master' },
      uid: 'test-uid-123',
    })
    mockAbortInteraction.mockResolvedValueOnce({ success: true })

    render(<InteractionPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => {
      expect(mockAbortInteraction).toHaveBeenCalledWith('test-uid-123')
    })
  })
})
