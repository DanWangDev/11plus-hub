import { useState, useEffect, useCallback } from 'react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card } from '@/components/ui/Card'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { listAuditLog, type AuditEntry } from '@/api/admin'

const ACTION_BADGES: Record<string, string> = {
  login: 'bg-green-100 text-green-700',
  login_failed: 'bg-red-100 text-red-700',
  register: 'bg-blue-100 text-blue-700',
  logout: 'bg-slate-100 text-slate-600',
  password_reset_request: 'bg-amber-100 text-amber-700',
  password_reset_complete: 'bg-amber-100 text-amber-700',
  user_update: 'bg-purple-100 text-purple-700',
  user_delete: 'bg-red-100 text-red-700',
  subscription_create: 'bg-blue-100 text-blue-700',
  subscription_update: 'bg-purple-100 text-purple-700',
  subscription_cancel: 'bg-red-100 text-red-700',
  app_access_grant: 'bg-green-100 text-green-700',
  app_access_revoke: 'bg-red-100 text-red-700',
  app_register: 'bg-blue-100 text-blue-700',
  app_update: 'bg-purple-100 text-purple-700',
  app_delete: 'bg-red-100 text-red-700',
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'loaded'; entries: AuditEntry[]; total: number }
  | { kind: 'error'; message: string }

export function AdminAuditPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [actionFilter, setActionFilter] = useState('')
  const [page, setPage] = useState(1)
  const limit = 30

  const fetchData = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const response = await listAuditLog({
        page,
        limit,
        action: actionFilter || undefined,
      })
      setState({
        kind: 'loaded',
        entries: response.data ?? [],
        total: response.meta?.total ?? 0,
      })
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to load audit log',
      })
    }
  }, [page, actionFilter])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Audit Log</h1>
        <p className="mt-1 text-sm text-slate-500">Track actions across the platform</p>
      </div>

      <Card className="mb-6 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value)
              setPage(1)
            }}
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            <optgroup label="Authentication">
              <option value="login">Login</option>
              <option value="login_failed">Login Failed</option>
              <option value="register">Register</option>
              <option value="logout">Logout</option>
            </optgroup>
            <optgroup label="Password">
              <option value="password_reset_request">Password Reset Request</option>
              <option value="password_reset_complete">Password Reset Complete</option>
            </optgroup>
            <optgroup label="Users">
              <option value="user_update">User Update</option>
              <option value="user_delete">User Delete</option>
            </optgroup>
            <optgroup label="Subscriptions">
              <option value="subscription_create">Subscription Create</option>
              <option value="subscription_update">Subscription Update</option>
              <option value="subscription_cancel">Subscription Cancel</option>
            </optgroup>
            <optgroup label="Applications">
              <option value="app_register">App Register</option>
              <option value="app_update">App Update</option>
              <option value="app_delete">App Delete</option>
              <option value="app_access_grant">App Access Grant</option>
              <option value="app_access_revoke">App Access Revoke</option>
            </optgroup>
          </select>
        </div>
      </Card>

      {state.kind === 'loading' && (
        <Card className="p-8 text-center text-slate-500">Loading audit log...</Card>
      )}

      {state.kind === 'error' && <Alert variant="error">{state.message}</Alert>}

      {state.kind === 'loaded' && state.entries.length === 0 && (
        <Card className="p-8 text-center text-slate-500">No audit entries found.</Card>
      )}

      {state.kind === 'loaded' && state.entries.length > 0 && (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                      Time
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                      Action
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                      Actor
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                      Target ID
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                      IP
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_BADGES[entry.action] ?? 'bg-slate-100 text-slate-700'}`}
                        >
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {entry.actor_username ?? (entry.actor_id ? `#${entry.actor_id}` : '—')}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{entry.target_id ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {entry.ip_address ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">
                        {Object.keys(entry.details).length > 0
                          ? JSON.stringify(entry.details)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{state.total} total entries</span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={state.entries.length < limit}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  )
}
