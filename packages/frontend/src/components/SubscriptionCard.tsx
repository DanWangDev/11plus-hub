import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/contexts/auth-context'
import { apiClient } from '@/lib/api-client'
import type { ApiResponse } from '@/types/api'
import { CreditCard, Crown, Sparkles } from 'lucide-react'

const planLabels: Record<string, string> = {
  free: 'Free',
  writing: 'Writing Buddy',
  bundle: 'Full Bundle',
}

const statusLabels: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'bg-emerald-100 text-emerald-700' },
  trial: { label: 'Trial', color: 'bg-amber-100 text-amber-700' },
  past_due: { label: 'Past Due', color: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', color: 'bg-slate-100 text-slate-600' },
  free: { label: 'Free Plan', color: 'bg-slate-100 text-slate-600' },
}

function getStatus(plan: string, expiresAt: string | null): { label: string; color: string } {
  if (plan === 'free') return statusLabels.free

  if (expiresAt) {
    const expiry = new Date(expiresAt)
    if (expiry < new Date()) return statusLabels.cancelled
  }

  return statusLabels.active
}

export function SubscriptionCard() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)

  if (!user) return null

  const plan = user.plan ?? 'free'
  const isPaid = plan !== 'free'
  const status = getStatus(plan, user.expires_at)

  async function handleUpgrade() {
    setLoading(true)
    try {
      const res = await apiClient.post<ApiResponse<{ url: string }>>('/api/stripe/checkout')
      if (res.data?.url) {
        window.location.href = res.data.url
      }
    } catch {
      // Checkout creation failed, user stays on page
    } finally {
      setLoading(false)
    }
  }

  async function handleManage() {
    setLoading(true)
    try {
      const res = await apiClient.post<ApiResponse<{ url: string }>>('/api/stripe/portal')
      if (res.data?.url) {
        window.location.href = res.data.url
      }
    } catch {
      // Portal creation failed, user stays on page
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${isPaid ? 'bg-amber-50 text-amber-500' : 'bg-slate-50 text-slate-400'}`}
          >
            {isPaid ? <Crown size={20} /> : <Sparkles size={20} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{planLabels[plan] ?? plan}</h3>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}
              >
                {status.label}
              </span>
            </div>
            {isPaid && user.features.length > 0 && (
              <p className="mt-0.5 text-xs text-slate-500">{user.features.join(', ')}</p>
            )}
            {!isPaid && (
              <p className="mt-0.5 text-xs text-slate-500">Upgrade to unlock Writing Buddy</p>
            )}
          </div>
        </div>

        {isPaid ? (
          <Button
            variant="secondary"
            className="!rounded-lg !px-3 !py-2 !min-h-0 text-xs"
            onClick={handleManage}
            disabled={loading}
          >
            <CreditCard size={14} className="mr-1.5" />
            Manage
          </Button>
        ) : (
          <Button
            variant="primary"
            className="!rounded-lg !px-3 !py-2 !min-h-0 text-xs"
            onClick={handleUpgrade}
            disabled={loading}
          >
            Upgrade
          </Button>
        )}
      </div>
    </Card>
  )
}
