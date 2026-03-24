import { Link, useNavigate } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { useForm } from '@/hooks/use-form'
import { loginSchema, type LoginFormData } from '@/lib/validation'
import { login } from '@/api/auth'
import { ApiError } from '@/lib/api-client'

export function LoginPage() {
  const navigate = useNavigate()

  const form = useForm<LoginFormData>({
    schema: loginSchema,
    onSubmit: async (data) => {
      try {
        const response = await login(data)
        if (response.success && response.data) {
          navigate('/dashboard')
        }
      } catch (error) {
        if (error instanceof ApiError) {
          throw new Error(
            error.status === 401
              ? 'Invalid email or password'
              : error.message,
          )
        }
        throw error
      }
    },
  })

  return (
    <AuthLayout title="Sign In" subtitle="Your family's learning hub">
      {form.serverError && (
        <Alert variant="error" className="mb-4">
          {form.serverError}
        </Alert>
      )}

      <form onSubmit={form.handleSubmit} noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@example.com"
          value={(form.values.email as string) ?? ''}
          onChange={(e) => form.setValue('email', e.target.value)}
          error={form.errors.email}
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

        <Button
          type="submit"
          loading={form.isSubmitting}
          className="mt-2 w-full"
        >
          Sign in
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link
          to="/forgot-password"
          className="text-primary-600 hover:text-primary-700"
        >
          Forgot password?
        </Link>
        <Link
          to="/signup"
          className="text-primary-600 hover:text-primary-700"
        >
          Create account
        </Link>
      </div>
    </AuthLayout>
  )
}
