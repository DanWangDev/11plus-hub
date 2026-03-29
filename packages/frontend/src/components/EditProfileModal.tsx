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

const MIN_PASSWORD_LENGTH = 8

export function EditProfileModal({ open, onClose, onToast }: EditProfileModalProps) {
  const { user, refresh } = useAuth()

  // Display name state
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameSaving, setNameSaving] = useState(false)
  const [nameServerError, setNameServerError] = useState<string | null>(null)

  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({})
  const [pwSaving, setPwSaving] = useState(false)
  const [pwServerError, setPwServerError] = useState<string | null>(null)

  const resetForm = useCallback(() => {
    setDisplayName(user?.display_name ?? '')
    setNameError(null)
    setNameServerError(null)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPwErrors({})
    setPwServerError(null)
  }, [user])

  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [resetForm, onClose])

  // --- Display name save ---
  const handleNameSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setNameServerError(null)

    const trimmed = displayName.trim()
    if (!trimmed) {
      setNameError('Display name is required')
      return
    }
    if (trimmed.length > 100) {
      setNameError('Display name must be 100 characters or less')
      return
    }
    setNameError(null)

    if (trimmed === user?.display_name) {
      onToast({ variant: 'success', text: 'Display name unchanged' })
      return
    }

    setNameSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName: trimmed }),
      })
      const json = (await res.json()) as ApiResponse
      if (!res.ok || !json.success) {
        setNameServerError(json.error ?? 'Update failed')
        return
      }
      await refresh()
      onToast({ variant: 'success', text: 'Display name updated' })
    } catch {
      setNameServerError('Network error — please try again')
    } finally {
      setNameSaving(false)
    }
  }

  // --- Password save ---
  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setPwServerError(null)

    const next: Record<string, string> = {}
    if (!currentPassword) {
      next.currentPassword = 'Current password is required'
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      next.newPassword = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    }
    if (newPassword !== confirmPassword) {
      next.confirmPassword = 'Passwords do not match'
    }
    setPwErrors(next)
    if (Object.keys(next).length > 0) return

    setPwSaving(true)
    try {
      const res = await fetch('/api/profile/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const json = (await res.json()) as ApiResponse
      if (!res.ok || !json.success) {
        setPwServerError(json.error ?? 'Password change failed')
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      onToast({ variant: 'success', text: 'Password changed' })
    } catch {
      setPwServerError('Network error — please try again')
    } finally {
      setPwSaving(false)
    }
  }

  const showPasswordSection = user?.has_password !== false

  return (
    <Modal open={open} onClose={handleClose} title="Edit Profile">
      <div className="space-y-6">
        {/* Display name section */}
        <form onSubmit={handleNameSubmit} noValidate>
          {nameServerError && (
            <div className="mb-3">
              <Alert variant="error">{nameServerError}</Alert>
            </div>
          )}
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
              if (nameError) setNameError(null)
            }}
            error={nameError ?? undefined}
            autoFocus
            maxLength={100}
          />
          <div className="mt-3">
            <Button type="submit" loading={nameSaving}>
              Save name
            </Button>
          </div>
        </form>

        {/* Password section */}
        {showPasswordSection && (
          <form onSubmit={handlePasswordSubmit} noValidate>
            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm font-medium text-slate-700">Change password</p>
              <p className="mt-0.5 mb-3 text-xs text-slate-400">
                Leave blank to keep current password
              </p>
            </div>

            {pwServerError && (
              <div className="mb-3">
                <Alert variant="error">{pwServerError}</Alert>
              </div>
            )}

            <Input
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value)
                if (pwErrors.currentPassword) {
                  setPwErrors((prev) => {
                    const { currentPassword: _, ...rest } = prev
                    return rest
                  })
                }
              }}
              error={pwErrors.currentPassword}
              autoComplete="current-password"
            />
            <Input
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value)
                if (pwErrors.newPassword) {
                  setPwErrors((prev) => {
                    const { newPassword: _, ...rest } = prev
                    return rest
                  })
                }
              }}
              error={pwErrors.newPassword}
              autoComplete="new-password"
            />
            <Input
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                if (pwErrors.confirmPassword) {
                  setPwErrors((prev) => {
                    const { confirmPassword: _, ...rest } = prev
                    return rest
                  })
                }
              }}
              error={pwErrors.confirmPassword}
              autoComplete="new-password"
            />
            <div className="mt-3">
              <Button type="submit" loading={pwSaving}>
                Change password
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}
