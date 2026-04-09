import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/contexts/auth-context'
import { CheckCircle } from 'lucide-react'

export function PaymentSuccessOverlay() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [visible, setVisible] = useState(false)
  const { refresh } = useAuth()

  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      setVisible(true)
      // Clear the query param without page reload
      setSearchParams({}, { replace: true })
      // Refresh JWT so plan claim updates
      void refresh()
    }
  }, [searchParams, setSearchParams, refresh])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-labelledby="payment-success-title"
    >
      <Card className="mx-4 w-full max-w-sm p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle size={32} className="text-emerald-500" />
        </div>
        <h2 id="payment-success-title" className="text-xl font-bold text-slate-900">
          You're all set!
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Writing Buddy is now active. Your child can start practising 11+ essays right away.
        </p>
        <Button variant="primary" className="mt-6 w-full" onClick={() => setVisible(false)}>
          Go to Dashboard
        </Button>
      </Card>
    </div>
  )
}
