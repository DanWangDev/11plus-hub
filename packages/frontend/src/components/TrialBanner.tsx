import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/contexts/auth-context'
import { Clock } from 'lucide-react'

function getDaysRemaining(expiresAt: string | null): number | null {
  if (!expiresAt) return null
  const expiry = new Date(expiresAt)
  const now = new Date()
  const diffMs = expiry.getTime() - now.getTime()
  if (diffMs <= 0) return 0
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

export function TrialBanner() {
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  if (!user || dismissed) return null

  // Only show for trial plans with an expiry
  const isTrial = user.plan !== 'free' && user.expires_at
  if (!isTrial) return null

  const daysLeft = getDaysRemaining(user.expires_at)
  if (daysLeft === null) return null

  const isExpired = daysLeft === 0
  const isUrgent = daysLeft <= 3

  return (
    <div
      className={`rounded-lg px-4 py-3 text-sm ${
        isExpired
          ? 'bg-red-50 text-red-700'
          : isUrgent
            ? 'bg-amber-50 text-amber-700'
            : 'bg-blue-50 text-blue-700'
      }`}
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock size={16} className="shrink-0" />
          <span>
            {isExpired
              ? 'Your trial has ended.'
              : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left in your trial.`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/pricing"
            className="font-medium underline underline-offset-2 hover:no-underline"
          >
            {isExpired ? 'Subscribe now' : 'Upgrade'}
          </Link>
          <button
            onClick={() => setDismissed(true)}
            className="ml-1 text-xs opacity-60 hover:opacity-100"
            aria-label="Dismiss trial banner"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  )
}
