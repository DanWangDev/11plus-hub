import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'
import { TurnstileWidget, isTurnstileEnabled } from '@/components/TurnstileWidget'
import { useForm } from '@/hooks/use-form'
import { loginSchema, type LoginFormData } from '@/lib/validation'
import { login, googleAuth } from '@/api/auth'
import { ApiError } from '@/lib/api-client'
import { useAuth } from '@/contexts/auth-context'

export function LoginPage() {
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)

  const form = useForm<LoginFormData>({
    schema: loginSchema,
    onSubmit: async (data) => {
      try {
        const response = await login({
          ...data,
          turnstileToken: turnstileToken ?? undefined,
        })
        if (response.success && response.data) {
          const { user } = response.data
          setUser(user)
          navigate(user.role === 'admin' ? '/admin' : '/dashboard')
        }
      } catch (error) {
        if (error instanceof ApiError) {
          throw new Error(error.status === 401 ? 'Invalid credentials' : error.message)
        }
        throw error
      }
    },
  })

  const handleGoogleSuccess = async (accessToken: string) => {
    setGoogleError(null)
    setGoogleLoading(true)
    try {
      const response = await googleAuth({
        token: accessToken,
        tokenType: 'access_token',
        turnstileToken: turnstileToken ?? undefined,
      })
      if (response.success && response.data) {
        const { user } = response.data
        setUser(user)
        navigate(user.role === 'admin' ? '/admin' : '/dashboard')
      }
    } catch (error) {
      setGoogleError(error instanceof ApiError ? error.message : 'Google sign-in failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <AuthLayout title="Sign In" subtitle="Your family's learning hub">
      {form.serverError && (
        <Alert variant="error" className="mb-4">
          {form.serverError}
        </Alert>
      )}
      {googleError && (
        <Alert variant="error" className="mb-4">
          {googleError}
        </Alert>
      )}

      <form onSubmit={form.handleSubmit} noValidate>
        <Input
          label="Email or Username"
          type="text"
          autoComplete="username"
          autoFocus
          required
          placeholder="you@example.com or username"
          value={(form.values.identifier as string) ?? ''}
          onChange={(e) => form.setValue('identifier', e.target.value)}
          error={form.errors.identifier}
        />

        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Enter your password"
          value={(form.values.password as string) ?? ''}
          onChange={(e) => form.setValue('password', e.target.value)}
          error={form.errors.password}
        />

        <TurnstileWidget onVerify={setTurnstileToken} onExpire={() => setTurnstileToken(null)} />

        <Button
          type="submit"
          loading={form.isSubmitting}
          disabled={isTurnstileEnabled && !turnstileToken}
          className="mt-2 w-full"
        >
          Sign in
        </Button>
      </form>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-2 text-slate-500">or</span>
        </div>
      </div>

      <GoogleSignInButton
        onSuccess={handleGoogleSuccess}
        onError={() => setGoogleError('Google sign-in was cancelled')}
        disabled={googleLoading || (isTurnstileEnabled && !turnstileToken)}
      />

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link to="/forgot-password" className="text-primary-600 hover:text-primary-700">
          Forgot password?
        </Link>
        <Link to="/signup" className="text-primary-600 hover:text-primary-700">
          Create account
        </Link>
      </div>
    </AuthLayout>
  )
}
