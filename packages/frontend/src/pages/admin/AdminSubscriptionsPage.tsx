import { useState, useEffect, useCallback } from 'react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import {
  listSubscriptions,
  createSubscription,
  updateSubscription,
  type Subscription,
} from '@/api/admin'
import { Pencil, X, Check, Plus } from 'lucide-react'

const PLAN_BADGES: Record<string, string> = {
  free: 'bg-slate-100 text-slate-700',
  writing: 'bg-blue-100 text-blue-700',
  vocab: 'bg-purple-100 text-purple-700',
  bundle: 'bg-amber-100 text-amber-700',
  family: 'bg-green-100 text-green-700',
}

const STATUS_BADGES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trial: 'bg-blue-100 text-blue-700',
  expired: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-600',
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'loaded'; subscriptions: Subscription[]; total: number }
  | { kind: 'error'; message: string }

interface EditingSub {
  id: number
  plan: string
  status: string
  features: string
}

export function AdminSubscriptionsPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [planFilter, setPlanFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<EditingSub | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const limit = 20

  // Create form
  const [newUserId, setNewUserId] = useState('')
  const [newPlan, setNewPlan] = useState('free')
  const [newFeatures, setNewFeatures] = useState('')

  const fetchData = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const response = await listSubscriptions({
        page,
        limit,
        plan: planFilter || undefined,
        status: statusFilter || undefined,
      })
      setState({
        kind: 'loaded',
        subscriptions: response.data ?? [],
        total: response.meta?.total ?? 0,
      })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to load subscriptions',
      })
    }
  }, [page, planFilter, statusFilter])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await createSubscription({
        user_id: Number(newUserId),
        plan: newPlan,
        features: newFeatures
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean),
      })
      setShowCreate(false)
      setNewUserId('')
      setNewPlan('free')
      setNewFeatures('')
      void fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create subscription')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (sub: Subscription) => {
    setEditing({
      id: sub.id,
      plan: sub.plan,
      status: sub.status,
      features: sub.features.join(', '),
    })
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    setSaving(true)
    setError('')
    try {
      await updateSubscription(editing.id, {
        plan: editing.plan,
        status: editing.status,
        features: editing.features
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean),
      })
      setEditing(null)
      void fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subscription')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Subscriptions</h1>
          <p className="mt-1 text-sm text-slate-500">Manage user subscriptions and plans</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? <X size={16} /> : <Plus size={16} />}
          <span className="ml-1">{showCreate ? 'Cancel' : 'Assign Plan'}</span>
        </Button>
      </div>

      {error && (
        <Alert variant="error" className="mb-4">{error}</Alert>
      )}

      {showCreate && (
        <Card className="mb-6 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Assign Subscription</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="User ID"
                type="number"
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                placeholder="1"
                required
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Plan</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={newPlan}
                  onChange={(e) => setNewPlan(e.target.value)}
                >
                  <option value="free">Free</option>
                  <option value="writing">Writing</option>
                  <option value="vocab">Vocab</option>
                  <option value="bundle">Bundle</option>
                  <option value="family">Family</option>
                </select>
              </div>
              <Input
                label="Features (comma-separated)"
                value={newFeatures}
                onChange={(e) => setNewFeatures(e.target.value)}
                placeholder="writing, vocab"
              />
            </div>
            <Button type="submit" loading={saving}>
              Assign
            </Button>
          </form>
        </Card>
      )}

      <Card className="mb-6 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={planFilter}
            onChange={(e) => {
              setPlanFilter(e.target.value)
              setPage(1)
            }}
            aria-label="Filter by plan"
          >
            <option value="">All plans</option>
            <option value="free">Free</option>
            <option value="writing">Writing</option>
            <option value="vocab">Vocab</option>
            <option value="bundle">Bundle</option>
            <option value="family">Family</option>
          </select>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </Card>

      {state.kind === 'loading' && (
        <Card className="p-8 text-center text-slate-500">Loading subscriptions...</Card>
      )}

      {state.kind === 'error' && (
        <Alert variant="error">{state.message}</Alert>
      )}

      {state.kind === 'loaded' && state.subscriptions.length === 0 && (
        <Card className="p-8 text-center text-slate-500">
          No subscriptions found.
        </Card>
      )}

      {state.kind === 'loaded' && state.subscriptions.length > 0 && (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">ID</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">User ID</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Plan</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Features</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Expires</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.subscriptions.map((sub) => (
                    <tr key={sub.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500">{sub.id}</td>
                      <td className="px-4 py-3 text-slate-600">{sub.user_id}</td>
                      <td className="px-4 py-3">
                        {editing?.id === sub.id ? (
                          <select
                            className="rounded border border-slate-300 px-2 py-1 text-sm"
                            value={editing.plan}
                            onChange={(e) => setEditing({ ...editing, plan: e.target.value })}
                          >
                            <option value="free">Free</option>
                            <option value="writing">Writing</option>
                            <option value="vocab">Vocab</option>
                            <option value="bundle">Bundle</option>
                            <option value="family">Family</option>
                          </select>
                        ) : (
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_BADGES[sub.plan] ?? 'bg-slate-100 text-slate-700'}`}
                          >
                            {sub.plan}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editing?.id === sub.id ? (
                          <select
                            className="rounded border border-slate-300 px-2 py-1 text-sm"
                            value={editing.status}
                            onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                          >
                            <option value="active">Active</option>
                            <option value="trial">Trial</option>
                            <option value="expired">Expired</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        ) : (
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[sub.status] ?? 'bg-slate-100 text-slate-600'}`}
                          >
                            {sub.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editing?.id === sub.id ? (
                          <input
                            className="rounded border border-slate-300 px-2 py-1 text-sm"
                            value={editing.features}
                            onChange={(e) => setEditing({ ...editing, features: e.target.value })}
                            placeholder="writing, vocab"
                          />
                        ) : (
                          <span className="text-xs text-slate-500">
                            {sub.features.length > 0 ? sub.features.join(', ') : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {sub.expires_at ? new Date(sub.expires_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {editing?.id === sub.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={handleSaveEdit}
                              disabled={saving}
                              className="rounded p-1.5 text-green-600 hover:bg-green-50"
                              title="Save"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => setEditing(null)}
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-100"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleEdit(sub)}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            title="Edit subscription"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{state.total} total subscriptions</span>
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
                disabled={state.subscriptions.length < limit}
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
