import { useState } from 'react'
import { Link } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { useForm } from '@/hooks/use-form'
import { forgotPasswordSchema, type ForgotPasswordFormData } from '@/lib/validation'
import { forgotPassword } from '@/api/password-reset'

export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)

  const form = useForm<ForgotPasswordFormData>({
    schema: forgotPasswordSchema,
    onSubmit: async (data) => {
      await forgotPassword(data)
      setSubmitted(true)
    },
  })

  if (submitted) {
    return (
      <AuthLayout title="Check your email" subtitle="We've sent you a password reset link">
        <Alert variant="info">
          If an account exists with that email, a reset link has been sent. Check your inbox and
          follow the instructions.
        </Alert>
        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-primary-600 hover:text-primary-700">
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Forgot password?"
      subtitle="Enter your email and we'll send you a reset link"
    >
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

        <Button type="submit" loading={form.isSubmitting} className="mt-2 w-full">
          Send reset link
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link to="/login" className="text-sm text-primary-600 hover:text-primary-700">
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  )
}
