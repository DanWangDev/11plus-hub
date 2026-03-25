import { useState, useEffect, useCallback } from 'react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { listApplications } from '@/api/apps'
import { createApplication, updateApplication, rotateClientSecret } from '@/api/admin'
import type { Application } from '@/types/api'
import { Copy, KeyRound, Pencil, Plus, X } from 'lucide-react'

const STATUS_BADGES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-slate-100 text-slate-600',
  archived: 'bg-red-100 text-red-700',
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'loaded'; apps: Application[] }
  | { kind: 'error'; message: string }

interface RevealedSecret {
  appId: number
  clientId: string
  clientSecret: string
}

interface EditingApp {
  id: number
  name: string
  url: string
  status: string
  redirect_uris: string
}

export function AdminAppsPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [showCreate, setShowCreate] = useState(false)
  const [revealedSecret, setRevealedSecret] = useState<RevealedSecret | null>(null)
  const [editing, setEditing] = useState<EditingApp | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  // Create form
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newRedirects, setNewRedirects] = useState('')

  const fetchApps = useCallback(async () => {
    try {
      const response = await listApplications()
      setState({ kind: 'loaded', apps: response.data ?? [] })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to load apps',
      })
    }
  }, [])

  useEffect(() => {
    void fetchApps()
  }, [fetchApps])

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 2000)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const response = await createApplication({
        name: newName,
        slug: newSlug,
        url: newUrl,
        redirect_uris: newRedirects
          .split('\n')
          .map((u) => u.trim())
          .filter(Boolean),
      })
      if (response.success && response.data) {
        setRevealedSecret({
          appId: response.data.id,
          clientId: response.data.client_id,
          clientSecret: response.data.client_secret ?? '',
        })
        setShowCreate(false)
        setNewName('')
        setNewSlug('')
        setNewUrl('')
        setNewRedirects('')
        void fetchApps()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create app')
    } finally {
      setSaving(false)
    }
  }

  const handleRotate = async (appId: number) => {
    setSaving(true)
    setError('')
    try {
      const response = await rotateClientSecret(appId)
      if (response.success && response.data) {
        setRevealedSecret({
          appId: response.data.id,
          clientId: response.data.client_id,
          clientSecret: response.data.client_secret,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate secret')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (app: Application) => {
    setEditing({
      id: app.id,
      name: app.name,
      url: app.url,
      status: app.status,
      redirect_uris: app.redirect_uris.join('\n'),
    })
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    setSaving(true)
    setError('')
    try {
      await updateApplication(editing.id, {
        name: editing.name,
        url: editing.url,
        status: editing.status,
        redirect_uris: editing.redirect_uris
          .split('\n')
          .map((u) => u.trim())
          .filter(Boolean),
      })
      setEditing(null)
      void fetchApps()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update app')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Applications</h1>
          <p className="mt-1 text-sm text-slate-500">Registered apps in the platform</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? <X size={16} /> : <Plus size={16} />}
          <span className="ml-1">{showCreate ? 'Cancel' : 'Register App'}</span>
        </Button>
      </div>

      {error && (
        <Alert variant="error" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Secret reveal banner */}
      {revealedSecret && (
        <Card className="mb-6 border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 text-sm font-semibold text-amber-800">
            Client credentials — copy now, the secret won't be shown again
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-amber-700 w-24">Client ID:</span>
              <code className="flex-1 rounded bg-white px-2 py-1 text-xs font-mono">
                {revealedSecret.clientId}
              </code>
              <button
                onClick={() => handleCopy(revealedSecret.clientId, 'id')}
                className="rounded p-1 text-amber-600 hover:bg-amber-100"
                aria-label="Copy client ID"
              >
                <Copy size={14} />
              </button>
              {copied === 'id' && <span className="text-xs text-green-600">Copied</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-amber-700 w-24">Client Secret:</span>
              <code className="flex-1 rounded bg-white px-2 py-1 text-xs font-mono">
                {revealedSecret.clientSecret}
              </code>
              <button
                onClick={() => handleCopy(revealedSecret.clientSecret, 'secret')}
                className="rounded p-1 text-amber-600 hover:bg-amber-100"
                aria-label="Copy client secret"
              >
                <Copy size={14} />
              </button>
              {copied === 'secret' && <span className="text-xs text-green-600">Copied</span>}
            </div>
          </div>
          <button
            onClick={() => setRevealedSecret(null)}
            className="mt-3 text-xs text-amber-700 underline hover:text-amber-900"
          >
            Dismiss
          </button>
        </Card>
      )}

      {/* Create form */}
      {showCreate && (
        <Card className="mb-6 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Register New Application</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="App Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Vocab Master"
                required
              />
              <Input
                label="Slug"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="vocab-master"
                required
              />
            </div>
            <Input
              label="URL"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://vocab-master.labf.app"
              required
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Redirect URIs (one per line)
              </label>
              <textarea
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                rows={3}
                value={newRedirects}
                onChange={(e) => setNewRedirects(e.target.value)}
                placeholder="https://vocab-master.labf.app/auth/callback&#10;http://localhost:5174/auth/callback"
                required
              />
            </div>
            <Button type="submit" loading={saving}>
              Create Application
            </Button>
          </form>
        </Card>
      )}

      {/* Edit modal */}
      {editing && (
        <Card className="mb-6 border-primary-200 bg-primary-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Editing: {editing.name}</h2>
          <div className="space-y-3">
            <Input
              label="App Name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <Input
              label="URL"
              value={editing.url}
              onChange={(e) => setEditing({ ...editing, url: e.target.value })}
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
              <select
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Redirect URIs (one per line)
              </label>
              <textarea
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                rows={3}
                value={editing.redirect_uris}
                onChange={(e) => setEditing({ ...editing, redirect_uris: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveEdit} loading={saving}>
                Save
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {state.kind === 'loading' && (
        <Card className="p-8 text-center text-slate-500">Loading applications...</Card>
      )}

      {state.kind === 'error' && <Alert variant="error">{state.message}</Alert>}

      {state.kind === 'loaded' && state.apps.length === 0 && (
        <Card className="p-8 text-center text-slate-500">
          No apps registered. Register your first app.
        </Card>
      )}

      {state.kind === 'loaded' && state.apps.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                    Slug
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                    Client ID
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                    Created
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-slate-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.apps.map((app) => (
                  <tr key={app.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{app.name}</div>
                      <div className="text-xs text-slate-500">{app.url}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{app.slug}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <code className="font-mono text-xs text-slate-500">{app.client_id}</code>
                        <button
                          onClick={() => handleCopy(app.client_id, `cid-${app.id}`)}
                          className="rounded p-0.5 text-slate-400 hover:text-slate-600"
                          aria-label="Copy client ID"
                        >
                          <Copy size={12} />
                        </button>
                        {copied === `cid-${app.id}` && (
                          <span className="text-xs text-green-600">Copied</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[app.status] ?? 'bg-slate-100 text-slate-600'}`}
                      >
                        {app.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(app.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleEdit(app)}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleRotate(app.id)}
                          className="rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                          title="Rotate client secret"
                        >
                          <KeyRound size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </AdminLayout>
  )
}
