import { useState } from 'react'
import { Link } from 'react-router'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'
import { useAuth } from '@/contexts/auth-context'
import { apiClient } from '@/lib/api-client'
import type { ApiResponse } from '@/types/api'
import { Check, ArrowLeft } from 'lucide-react'

const FREE_FEATURES = ['Hub SSO account', 'Dashboard access', 'Profile management']

const WRITING_FEATURES = [
  'Everything in Free',
  'Writing Buddy AI tutor',
  'Unlimited practice essays',
  'Instant AI feedback',
  'Progress tracking',
]

export function PricingPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)

  const isPaid = user && user.plan !== 'free'

  async function handleCheckout() {
    setLoading(true)
    try {
      const res = await apiClient.post<ApiResponse<{ url: string }>>('/api/stripe/checkout')
      if (res.data?.url) {
        window.location.href = res.data.url
      }
    } catch {
      // Stay on page
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-100 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Logo size="lg" />
          {user ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft size={14} />
              Back to Dashboard
            </Link>
          ) : (
            <Link
              to="/login"
              className="text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-bold text-slate-900">Simple, transparent pricing</h1>
            <p className="mt-2 text-slate-500">
              Help your child ace the 11+ with AI-powered practice
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {/* Free Plan */}
            <Card className="flex flex-col p-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-900">Free</h2>
                <p className="mt-1 text-sm text-slate-500">Get started with the basics</p>
                <div className="mt-4">
                  <span className="text-3xl font-bold text-slate-900">$0</span>
                  <span className="text-sm text-slate-500">/month</span>
                </div>
              </div>

              <ul className="mb-8 flex-1 space-y-3">
                {FREE_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-slate-600">
                    <Check size={16} className="mt-0.5 shrink-0 text-slate-400" />
                    {feature}
                  </li>
                ))}
              </ul>

              {user ? (
                <Button variant="secondary" disabled className="w-full">
                  {user.plan === 'free' ? 'Current plan' : 'Included'}
                </Button>
              ) : (
                <Link to="/signup">
                  <Button variant="secondary" className="w-full">
                    Sign up free
                  </Button>
                </Link>
              )}
            </Card>

            {/* Writing Buddy Plan */}
            <Card className="relative flex flex-col border-primary-200 p-6 shadow-md shadow-primary-100/50">
              <div className="absolute -top-3 left-6 rounded-full bg-primary-500 px-3 py-0.5 text-xs font-medium text-white">
                Popular
              </div>

              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-900">Writing Buddy</h2>
                <p className="mt-1 text-sm text-slate-500">AI-powered 11+ essay practice</p>
                <div className="mt-4">
                  <span className="text-3xl font-bold text-slate-900">$9.99</span>
                  <span className="text-sm text-slate-500">/month</span>
                </div>
              </div>

              <ul className="mb-8 flex-1 space-y-3">
                {WRITING_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-slate-600">
                    <Check size={16} className="mt-0.5 shrink-0 text-primary-500" />
                    {feature}
                  </li>
                ))}
              </ul>

              {isPaid ? (
                <Button variant="secondary" disabled className="w-full">
                  Current plan
                </Button>
              ) : user ? (
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={handleCheckout}
                  loading={loading}
                >
                  Get Writing Buddy
                </Button>
              ) : (
                <Link to="/signup">
                  <Button variant="primary" className="w-full">
                    Sign up to get started
                  </Button>
                </Link>
              )}
            </Card>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-100 bg-white px-4 py-6 text-center text-xs text-slate-400">
        Cancel anytime. No lock-in.
      </footer>
    </div>
  )
}
