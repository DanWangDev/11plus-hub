import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { AlertTriangle, X } from 'lucide-react'

const IMPERSONATION_TIMEOUT_MINUTES = 30

export function ImpersonationBanner() {
  const { user } = useAuth()
  const [timeLeft, setTimeLeft] = useState<number | null>(null)

  const impersonatedBy = user?.impersonatedBy

  useEffect(() => {
    if (!impersonatedBy) {
      setTimeLeft(null)
      return
    }

    const startedAt = new Date(impersonatedBy.startedAt).getTime()
    const expiresAt = startedAt + IMPERSONATION_TIMEOUT_MINUTES * 60 * 1000

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      setTimeLeft(remaining)
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [impersonatedBy])

  const endImpersonation = useCallback(async () => {
    try {
      await fetch('/api/admin/impersonate/end', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Even if the request fails, reload to get back to normal state
    }
    // Reload so the auth context picks up the restored session
    window.location.reload()
  }, [])

  if (!impersonatedBy) return null

  const minutes = timeLeft !== null ? Math.floor(timeLeft / 60) : 0
  const seconds = timeLeft !== null ? timeLeft % 60 : 0

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-amber-900 shadow-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" />
          <span>
            Viewing as <strong>{user?.username}</strong> (impersonated by{' '}
            {impersonatedBy.adminUsername})
          </span>
          <span className="ml-2 tabular-nums text-amber-800">
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')} remaining
          </span>
        </div>
        <button
          type="button"
          onClick={endImpersonation}
          className="flex items-center gap-1 rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          End session
        </button>
      </div>
    </div>
  )
}
