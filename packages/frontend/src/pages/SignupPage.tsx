import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { useForm } from '@/hooks/use-form'
import { signupSchema, type SignupFormData } from '@/lib/validation'
import { register } from '@/api/auth'
import { ApiError } from '@/lib/api-client'

export function SignupPage() {
  const navigate = useNavigate()
  const [success, setSuccess] = useState(false)

  const form = useForm<SignupFormData>({
    schema: signupSchema,
    onSubmit: async (data) => {
      try {
        const response = await register(data)
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

      <form onSubmit={form.handleSubmit} noValidate>
        <Input
          label="Display Name"
          type="text"
          autoComplete="name"
          autoFocus
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

        <Button type="submit" loading={form.isSubmitting} className="mt-2 w-full">
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
