import { useState, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { useForm } from '@/hooks/use-form'
import { resetPasswordSchema, type ResetPasswordFormData } from '@/lib/validation'
import { resetPassword } from '@/api/password-reset'

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const [success, setSuccess] = useState(false)

  const tokenParams = useMemo(
    () => ({
      selector: searchParams.get('selector') ?? '',
      validator: searchParams.get('validator') ?? '',
    }),
    [searchParams],
  )

  const form = useForm<ResetPasswordFormData>({
    schema: resetPasswordSchema,
    onSubmit: async (data) => {
      if (!tokenParams.selector || !tokenParams.validator) {
        throw new Error('Invalid or missing reset token')
      }
      await resetPassword({
        selector: tokenParams.selector,
        validator: tokenParams.validator,
        newPassword: data.newPassword,
      })
      setSuccess(true)
    },
  })

  if (!tokenParams.selector || !tokenParams.validator) {
    return (
      <AuthLayout title="Invalid Link">
        <Alert variant="error">This password reset link is invalid or has expired.</Alert>
        <div className="mt-4 text-center">
          <Link to="/forgot-password" className="text-sm text-primary-600 hover:text-primary-700">
            Request a new reset link
          </Link>
        </div>
      </AuthLayout>
    )
  }

  if (success) {
    return (
      <AuthLayout title="Password Reset" subtitle="Your password has been updated">
        <Alert variant="success">
          Your password has been reset successfully. You can now sign in with your new password.
        </Alert>
        <div className="mt-4 text-center">
          <Link to="/login" className="text-sm text-primary-600 hover:text-primary-700">
            Go to sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Reset Password" subtitle="Choose a new password">
      {form.serverError && (
        <Alert variant="error" className="mb-4">
          {form.serverError}
        </Alert>
      )}

      <form onSubmit={form.handleSubmit} noValidate>
        <Input
          label="New Password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          placeholder="At least 8 characters"
          value={(form.values.newPassword as string) ?? ''}
          onChange={(e) => form.setValue('newPassword', e.target.value)}
          error={form.errors.newPassword}
        />

        <Input
          label="Confirm Password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="Confirm your new password"
          value={(form.values.confirmPassword as string) ?? ''}
          onChange={(e) => form.setValue('confirmPassword', e.target.value)}
          error={form.errors.confirmPassword}
        />

        <Button type="submit" loading={form.isSubmitting} className="mt-2 w-full">
          Reset password
        </Button>
      </form>
    </AuthLayout>
  )
}
