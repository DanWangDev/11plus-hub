import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'
import { TurnstileWidget, isTurnstileEnabled } from '@/components/TurnstileWidget'
import { useForm } from '@/hooks/use-form'
import { signupSchema, type SignupFormData } from '@/lib/validation'
import { register, googleAuth } from '@/api/auth'
import { ApiError } from '@/lib/api-client'
import { useAuth } from '@/contexts/auth-context'

export function SignupPage() {
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [success, setSuccess] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)

  const form = useForm<SignupFormData>({
    schema: signupSchema,
    onSubmit: async (data) => {
      try {
        const response = await register({
          ...data,
          turnstileToken: turnstileToken ?? undefined,
        })
        if (response.success) {
          setSuccess(true)
          setTimeout(() => navigate('/login'), 2000)
        }
      } catch (error) {
        if (error instanceof ApiError) {
          throw new Error(
            error.status === 409
              ? 'An account with that username or email already exists'
              : error.message,
          )
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
      setGoogleError(error instanceof ApiError ? error.message : 'Google sign-up failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  if (success) {
    return (
      <AuthLayout title="Account Created" subtitle="You can now sign in">
        <Alert variant="success">Your account has been created. Redirecting to sign in...</Alert>
        <div className="mt-4 text-center">
          <Link to="/login" className="text-sm text-primary-600 hover:text-primary-700">
            Go to sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Create Account" subtitle="Join your family's learning hub">
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

      <GoogleSignInButton
        onSuccess={handleGoogleSuccess}
        onError={() => setGoogleError('Google sign-up was cancelled')}
        disabled={googleLoading || (isTurnstileEnabled && !turnstileToken)}
      />

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-2 text-slate-500">or sign up with email</span>
        </div>
      </div>

      <form onSubmit={form.handleSubmit} noValidate>
        <Input
          label="Display Name"
          type="text"
          autoComplete="name"
          required
          placeholder="Emma"
          value={(form.values.displayName as string) ?? ''}
          onChange={(e) => form.setValue('displayName', e.target.value)}
          error={form.errors.displayName}
        />

        <Input
          label="Username"
          type="text"
          autoComplete="username"
          required
          placeholder="emma_learns"
          value={(form.values.username as string) ?? ''}
          onChange={(e) => form.setValue('username', e.target.value)}
          error={form.errors.username}
        />

        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={(form.values.email as string) ?? ''}
          onChange={(e) => form.setValue('email', e.target.value)}
          error={form.errors.email}
        />

        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="At least 8 characters"
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
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link to="/login" className="text-primary-600 hover:text-primary-700">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
