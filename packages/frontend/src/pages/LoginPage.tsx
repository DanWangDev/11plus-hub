import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { useAuth } from '@/contexts/auth-context'

/**
 * LoginPage — redirects to the OIDC login flow.
 *
 * If the user is already authenticated (has a valid session cookie),
 * redirects to the dashboard instead. Otherwise, redirects to /api/auth/hub-login
 * which initiates the OIDC authorization flow with the hub's own provider.
 */
export function LoginPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return

    if (user) {
      // Already logged in — go to dashboard
      navigate(user.role === 'admin' ? '/admin' : '/dashboard', { replace: true })
      return
    }

    // Not logged in — redirect to OIDC login flow
    // The returnTo param tells the hub where to redirect after login
    const returnTo = new URLSearchParams(window.location.search).get('returnTo') ?? '/dashboard'
    window.location.href = `/api/auth/hub-login?returnTo=${encodeURIComponent(returnTo)}`
  }, [user, loading, navigate])

  return (
    <AuthLayout title="Redirecting..." subtitle="Taking you to sign in">
      <div className="flex justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-500" />
      </div>
    </AuthLayout>
  )
}
