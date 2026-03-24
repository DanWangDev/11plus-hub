import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { useForm } from '@/hooks/use-form'
import { loginSchema, type LoginFormData } from '@/lib/validation'
import type { InteractionDetails } from '@/types/api'
import {
  getInteractionDetails,
  submitInteractionLogin,
  submitInteractionConsent,
  abortInteraction,
} from '@/api/auth'
import { ApiError } from '@/lib/api-client'

type PageState =
  | { kind: 'loading' }
  | { kind: 'login'; uid: string; clientId: string }
  | { kind: 'consent'; uid: string; clientName: string; scopes: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'done' }

export function InteractionPage() {
  const { uid } = useParams<{ uid: string }>()
  const [state, setState] = useState<PageState>({ kind: 'loading' })

  useEffect(() => {
    if (!uid) {
      setState({ kind: 'error', message: 'Missing interaction ID' })
      return
    }

    let cancelled = false

    async function fetchDetails() {
      try {
        const details: InteractionDetails = await getInteractionDetails(uid!)
        if (cancelled) return

        if (details.prompt.name === 'login') {
          setState({
            kind: 'login',
            uid: uid!,
            clientId: details.params.client_id ?? '',
          })
        } else if (details.prompt.name === 'consent') {
          const scopes = details.params.scope?.split(' ').filter(Boolean) ?? []
          setState({
            kind: 'consent',
            uid: uid!,
            clientName: details.client?.name ?? details.params.client_id ?? 'Unknown app',
            scopes,
          })
        } else {
          setState({ kind: 'error', message: 'Unknown interaction type' })
        }
      } catch (error) {
        if (cancelled) return
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Failed to load interaction',
        })
      }
    }

    void fetchDetails()
    return () => {
      cancelled = true
    }
  }, [uid])

  if (state.kind === 'loading') {
    return (
      <AuthLayout title="Loading...">
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-500" />
        </div>
      </AuthLayout>
    )
  }

  if (state.kind === 'error') {
    return (
      <AuthLayout title="Error">
        <Alert variant="error">{state.message}</Alert>
      </AuthLayout>
    )
  }

  if (state.kind === 'done') {
    return (
      <AuthLayout title="Redirecting...">
        <p className="text-center text-sm text-slate-500">Please wait while we redirect you...</p>
      </AuthLayout>
    )
  }

  if (state.kind === 'consent') {
    return (
      <ConsentView
        uid={state.uid}
        clientName={state.clientName}
        scopes={state.scopes}
        onComplete={() => setState({ kind: 'done' })}
      />
    )
  }

  return (
    <InteractionLoginView
      uid={state.uid}
      clientId={state.clientId}
      onComplete={() => setState({ kind: 'done' })}
    />
  )
}

function InteractionLoginView({
  uid,
  clientId,
  onComplete,
}: {
  uid: string
  clientId: string
  onComplete: () => void
}) {
  const form = useForm<LoginFormData>({
    schema: loginSchema,
    onSubmit: async (data) => {
      try {
        await submitInteractionLogin(uid, data)
        onComplete()
      } catch (error) {
        if (error instanceof ApiError) {
          throw new Error(error.status === 401 ? 'Invalid email or password' : error.message)
        }
        throw error
      }
    },
  })

  return (
    <AuthLayout title="Sign In" subtitle="Your family's learning hub">
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

        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Enter your password"
          value={(form.values.password as string) ?? ''}
          onChange={(e) => form.setValue('password', e.target.value)}
          error={form.errors.password}
        />

        <Button type="submit" loading={form.isSubmitting} className="mt-2 w-full">
          Sign in
        </Button>
      </form>

      {clientId && (
        <p className="mt-4 text-center text-xs text-slate-400">Signing in to {clientId}</p>
      )}
    </AuthLayout>
  )
}

function ConsentView({
  uid,
  clientName,
  scopes,
  onComplete,
}: {
  uid: string
  clientName: string
  scopes: string[]
  onComplete: () => void
}) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleAllow = useCallback(async () => {
    setIsSubmitting(true)
    setError('')
    try {
      await submitInteractionConsent(uid)
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authorize')
    } finally {
      setIsSubmitting(false)
    }
  }, [uid, onComplete])

  const handleDeny = useCallback(async () => {
    setIsSubmitting(true)
    setError('')
    try {
      await abortInteraction(uid)
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deny')
    } finally {
      setIsSubmitting(false)
    }
  }, [uid, onComplete])

  return (
    <AuthLayout title="Authorize">
      {error && (
        <Alert variant="error" className="mb-4">
          {error}
        </Alert>
      )}

      <p className="mb-4 text-center text-sm text-slate-500">
        <strong className="text-slate-700">{clientName}</strong> is requesting access to:
      </p>

      {scopes.length > 0 && (
        <ul className="mb-6 space-y-1 text-sm text-slate-600">
          {scopes.map((scope) => (
            <li key={scope} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-400" aria-hidden="true" />
              {scope}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-3">
        <Button variant="secondary" onClick={handleDeny} disabled={isSubmitting} className="flex-1">
          Deny
        </Button>
        <Button onClick={handleAllow} loading={isSubmitting} className="flex-1">
          Allow
        </Button>
      </div>
    </AuthLayout>
  )
}
