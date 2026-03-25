import { useState, useEffect } from 'react'
import { DashboardLayout } from '@/components/DashboardLayout'
import { Card } from '@/components/ui/Card'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { ExternalLink } from 'lucide-react'
import { listApplications } from '@/api/apps'
import type { Application } from '@/types/api'

type PageState =
  | { kind: 'loading' }
  | { kind: 'loaded'; apps: Application[] }
  | { kind: 'error'; message: string }

export function DashboardPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function fetchApps() {
      try {
        const response = await listApplications()
        if (cancelled) return
        setState({
          kind: 'loaded',
          apps: response.data ?? [],
        })
      } catch (error) {
        if (cancelled) return
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Failed to load applications',
        })
      }
    }

    void fetchApps()
    return () => {
      cancelled = true
    }
  }, [])

  const handleRetry = () => {
    setState({ kind: 'loading' })
    void listApplications()
      .then((response) => {
        setState({ kind: 'loaded', apps: response.data ?? [] })
      })
      .catch((error) => {
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Failed to load applications',
        })
      })
  }

  return (
    <DashboardLayout userName="Student">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Good morning!</h1>
        <p className="mt-1 text-sm text-slate-500">Choose an app to get started</p>
      </div>

      {state.kind === 'loading' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {state.kind === 'error' && (
        <div className="space-y-4">
          <Alert variant="error">{state.message}</Alert>
          <Button variant="secondary" onClick={handleRetry}>
            Try again
          </Button>
        </div>
      )}

      {state.kind === 'loaded' && state.apps.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-slate-500">Welcome! Your apps are ready.</p>
        </Card>
      )}

      {state.kind === 'loaded' && state.apps.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.apps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}

function AppCard({ app }: { app: Application }) {
  return (
    <a href={app.url} className="group block" aria-label={`Open ${app.name}`}>
      <Card className="p-6 transition-shadow duration-150 group-hover:shadow-md">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
          {app.icon_url ? (
            <img src={app.icon_url} alt="" className="h-6 w-6" aria-hidden="true" />
          ) : (
            <span className="text-lg font-semibold" aria-hidden="true">
              {app.name.charAt(0)}
            </span>
          )}
        </div>
        <h2 className="text-base font-semibold text-slate-900">{app.name}</h2>
        <div className="mt-2 flex items-center gap-1 text-xs text-primary-600 group-hover:text-primary-700">
          <span>Open app</span>
          <ExternalLink size={12} aria-hidden="true" />
        </div>
      </Card>
    </a>
  )
}
