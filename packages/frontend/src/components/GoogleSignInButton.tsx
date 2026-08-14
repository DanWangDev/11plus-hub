import { useEffect, useRef } from 'react'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

interface GsiCredentialResponse {
  credential?: string
}

interface GsiAccountsId {
  initialize: (config: {
    client_id: string
    callback: (response: GsiCredentialResponse) => void
  }) => void
  renderButton: (el: HTMLElement, options: Record<string, unknown>) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GsiAccountsId } }
  }
}

interface GoogleSignInButtonOAuthProps {
  onSuccess: (idToken: string) => void
  onError?: (message?: string) => void
  disabled?: boolean
  onClick?: never
}

interface GoogleSignInButtonClickProps {
  onClick: () => void
  onSuccess?: never
  onError?: never
  disabled?: boolean
}

type GoogleSignInButtonProps = GoogleSignInButtonOAuthProps | GoogleSignInButtonClickProps

const GSI_SCRIPT_ID = 'gsi-client'
const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
let gsiScriptLoading: Promise<void> | null = null

/** Load the Google Identity Services script exactly once per page. */
function loadGsiScript(): Promise<void> {
  if (document.getElementById(GSI_SCRIPT_ID) || window.google?.accounts?.id) {
    return Promise.resolve()
  }
  if (gsiScriptLoading) {
    return gsiScriptLoading
  }

  gsiScriptLoading = new Promise((resolve) => {
    const script = document.createElement('script')
    script.id = GSI_SCRIPT_ID
    script.src = GSI_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Allow retry on a later mount; the button renders nothing without the API.
      gsiScriptLoading = null
      resolve()
    }
    document.head.appendChild(script)
  })
  return gsiScriptLoading
}

/**
 * Google Sign-In button.
 *
 * Two modes:
 * - OAuth mode (onSuccess): renders the official GIS button. onSuccess
 *   receives the Google ID token (credential) — never a raw access token,
 *   so the backend can verify audience + signature.
 * - Click mode (onClick): plain styled button that triggers a navigation
 *   (used by the signup page, which redirects into the OIDC flow).
 */
export function GoogleSignInButton(props: GoogleSignInButtonProps) {
  const buttonRef = useRef<HTMLDivElement>(null)
  const onSuccessRef = useRef(props.onSuccess)
  const onErrorRef = useRef(props.onError)
  onSuccessRef.current = props.onSuccess
  onErrorRef.current = props.onError

  useEffect(() => {
    if (props.onClick || !GOOGLE_CLIENT_ID) return

    let cancelled = false
    void loadGsiScript().then(() => {
      const google = window.google
      if (cancelled || !google || !buttonRef.current) return

      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          if (response.credential) {
            onSuccessRef.current?.(response.credential)
          } else {
            onErrorRef.current?.('Google sign-in failed. Please try again.')
          }
        },
      })
      google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 280,
        text: 'continue_with',
        shape: 'rectangular',
      })
    })

    return () => {
      cancelled = true
    }
  }, [props.onClick])

  if (props.onClick) {
    return (
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        className="flex w-full items-center justify-center gap-3 rounded-lg border-2 border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </button>
    )
  }

  if (!GOOGLE_CLIENT_ID) {
    return null
  }

  return (
    <div
      ref={buttonRef}
      className={`flex w-full justify-center ${props.disabled ? 'pointer-events-none opacity-50' : ''}`}
    />
  )
}
