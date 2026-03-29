import { useState, useCallback, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { useAuth } from '@/contexts/auth-context'
import type { ToastMessage } from '@/components/ui/Toast'
import type { ApiResponse } from '@/types/api'

interface EditProfileModalProps {
  open: boolean
  onClose: () => void
  onToast: (msg: Omit<ToastMessage, 'id'>) => void
}

interface FormState {
  displayName: string
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const MIN_PASSWORD_LENGTH = 8

export function EditProfileModal({ open, onClose, onToast }: EditProfileModalProps) {
  const { user, refresh } = useAuth()

  const [form, setForm] = useState<FormState>({
    displayName: user?.display_name ?? '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const resetForm = useCallback(() => {
    setForm({
      displayName: user?.display_name ?? '',
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    })
    setErrors({})
    setServerError(null)
  }, [user])

  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [resetForm, onClose])

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {}

    if (!form.displayName.trim()) {
      next.displayName = 'Display name is required'
    } else if (form.displayName.length > 100) {
      next.displayName = 'Display name must be 100 characters or less'
    }

    const changingPassword = form.newPassword || form.currentPassword
    if (changingPassword) {
      if (!form.currentPassword) {
        next.currentPassword = 'Current password is required'
      }
      if (form.newPassword.length < MIN_PASSWORD_LENGTH) {
        next.newPassword = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
      }
      if (form.newPassword !== form.confirmPassword) {
        next.confirmPassword = 'Passwords do not match'
      }
    }

    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setServerError(null)

    if (!validate()) return

    setSubmitting(true)

    try {
      const body: Record<string, string> = {}
      if (form.displayName !== user?.display_name) {
        body.displayName = form.displayName.trim()
      }
      if (form.newPassword) {
        body.currentPassword = form.currentPassword
        body.newPassword = form.newPassword
      }

      if (Object.keys(body).length === 0) {
        handleClose()
        return
      }

      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      const json = (await res.json()) as ApiResponse

      if (!res.ok || !json.success) {
        setServerError(json.error ?? 'Update failed')
        return
      }

      await refresh()
      onToast({ variant: 'success', text: 'Profile updated' })
      handleClose()
    } catch {
      setServerError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  const updateField = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
    if (errors[field]) {
      setErrors((prev) => {
        const { [field]: _, ...rest } = prev
        return rest
      })
    }
  }

  const showPasswordSection = user?.has_password !== false

  return (
    <Modal open={open} onClose={handleClose} title="Edit Profile">
      <form onSubmit={handleSubmit} noValidate>
        {serverError && (
          <div className="mb-4">
            <Alert variant="error">{serverError}</Alert>
          </div>
        )}

        <Input
          label="Display name"
          value={form.displayName}
          onChange={updateField('displayName')}
          error={errors.displayName}
          autoFocus
          maxLength={100}
        />

        {showPasswordSection && (
          <>
            <div className="mb-3 mt-6 border-t border-slate-100 pt-4">
              <p className="text-sm font-medium text-slate-700">Change password</p>
              <p className="mt-0.5 text-xs text-slate-400">Leave blank to keep current password</p>
            </div>

            <Input
              label="Current password"
              type="password"
              value={form.currentPassword}
              onChange={updateField('currentPassword')}
              error={errors.currentPassword}
              autoComplete="current-password"
            />

            <Input
              label="New password"
              type="password"
              value={form.newPassword}
              onChange={updateField('newPassword')}
              error={errors.newPassword}
              autoComplete="new-password"
            />

            <Input
              label="Confirm new password"
              type="password"
              value={form.confirmPassword}
              onChange={updateField('confirmPassword')}
              error={errors.confirmPassword}
              autoComplete="new-password"
            />
          </>
        )}

        <div className="mt-6 flex gap-3">
          <Button type="submit" loading={submitting} className="flex-1">
            Save changes
          </Button>
          <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
