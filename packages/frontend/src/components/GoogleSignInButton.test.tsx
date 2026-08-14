import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'

// The component reads import.meta.env.VITE_GOOGLE_CLIENT_ID at module load,
// so tests must set the env var BEFORE dynamically importing the component.
beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('GoogleSignInButton', () => {
  it('renders a plain button that calls onClick in click mode', async () => {
    const onClick = vi.fn()
    const { GoogleSignInButton } = await import('./GoogleSignInButton')

    render(<GoogleSignInButton onClick={onClick} />)

    const button = screen.getByRole('button', { name: 'Continue with Google' })
    expect(button).toBeInTheDocument()

    await userEvent.click(button)
    expect(onClick).toHaveBeenCalled()
  })

  it('renders nothing in OAuth mode when no client id is configured', async () => {
    const { GoogleSignInButton } = await import('./GoogleSignInButton')

    const { container } = render(<GoogleSignInButton onSuccess={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('initializes GIS and renders the official button in OAuth mode', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com')
    const gsi = { initialize: vi.fn(), renderButton: vi.fn() }
    vi.stubGlobal('google', { accounts: { id: gsi } })

    const { GoogleSignInButton } = await import('./GoogleSignInButton')

    render(<GoogleSignInButton onSuccess={vi.fn()} />)

    await waitFor(() => {
      expect(gsi.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'test-client-id.apps.googleusercontent.com' }),
      )
      expect(gsi.renderButton).toHaveBeenCalled()
    })
  })

  it('passes the GIS credential (ID token) to onSuccess', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com')
    let captureCallback: ((r: { credential?: string }) => void) | undefined
    const gsi = {
      initialize: vi.fn((config: { callback: (r: { credential?: string }) => void }) => {
        captureCallback = config.callback
      }),
      renderButton: vi.fn(),
    }
    vi.stubGlobal('google', { accounts: { id: gsi } })

    const { GoogleSignInButton } = await import('./GoogleSignInButton')
    const onSuccess = vi.fn()
    const onError = vi.fn()

    render(<GoogleSignInButton onSuccess={onSuccess} onError={onError} />)

    await waitFor(() => expect(gsi.initialize).toHaveBeenCalled())
    captureCallback?.({ credential: 'google-id-token' })
    expect(onSuccess).toHaveBeenCalledWith('google-id-token')

    captureCallback?.({})
    expect(onError).toHaveBeenCalled()
  })
})
