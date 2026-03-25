import { useState, useEffect, useCallback } from 'react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { listUsers, updateUser } from '@/api/admin'
import type { User } from '@/types/api'
import { Pencil, X, Check } from 'lucide-react'

const ROLE_BADGES: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  parent: 'bg-blue-100 text-blue-700',
  student: 'bg-green-100 text-green-700',
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'loaded'; users: User[]; total: number }
  | { kind: 'error'; message: string }

interface EditingUser {
  id: number
  display_name: string
  email: string
  role: string
}

export function AdminUsersPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<EditingUser | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const limit = 20

  const fetchUsers = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const response = await listUsers({
        page,
        limit,
        search: search || undefined,
        role: roleFilter || undefined,
      })
      setState({
        kind: 'loaded',
        users: response.data ?? [],
        total: response.meta?.total ?? 0,
      })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to load users',
      })
    }
  }, [page, search, roleFilter])

  useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    void fetchUsers()
  }

  const handleEdit = (user: User) => {
    setEditing({
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
    })
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    setSaving(true)
    setError('')
    try {
      await updateUser(editing.id, {
        display_name: editing.display_name,
        email: editing.email,
        role: editing.role as User['role'],
      })
      setEditing(null)
      void fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <p className="mt-1 text-sm text-slate-500">Manage registered users</p>
      </div>

      {error && (
        <Alert variant="error" className="mb-4">{error}</Alert>
      )}

      <Card className="mb-6 p-4">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Input
              label=""
              placeholder="Search by username or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value)
              setPage(1)
            }}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="parent">Parent</option>
            <option value="student">Student</option>
          </select>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </Card>

      {state.kind === 'loading' && (
        <Card className="p-8 text-center text-slate-500">Loading users...</Card>
      )}

      {state.kind === 'error' && (
        <Alert variant="error">{state.message}</Alert>
      )}

      {state.kind === 'loaded' && state.users.length === 0 && (
        <Card className="p-8 text-center text-slate-500">
          No users match your search.
        </Card>
      )}

      {state.kind === 'loaded' && state.users.length > 0 && (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">ID</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Username</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Email</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Display Name</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Role</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Verified</th>
                    <th scope="col" className="px-4 py-3 font-medium text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.users.map((user) => (
                    <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500">{user.id}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{user.username}</td>
                      <td className="px-4 py-3">
                        {editing?.id === user.id ? (
                          <input
                            className="rounded border border-slate-300 px-2 py-1 text-sm"
                            value={editing.email}
                            onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                          />
                        ) : (
                          <span className="text-slate-600">{user.email}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editing?.id === user.id ? (
                          <input
                            className="rounded border border-slate-300 px-2 py-1 text-sm"
                            value={editing.display_name}
                            onChange={(e) =>
                              setEditing({ ...editing, display_name: e.target.value })
                            }
                          />
                        ) : (
                          <span className="text-slate-600">{user.display_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editing?.id === user.id ? (
                          <select
                            className="rounded border border-slate-300 px-2 py-1 text-sm"
                            value={editing.role}
                            onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                          >
                            <option value="student">Student</option>
                            <option value="parent">Parent</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : (
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGES[user.role] ?? 'bg-slate-100 text-slate-700'}`}
                          >
                            {user.role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {user.email_verified ? (
                          <span className="text-green-600">Yes</span>
                        ) : (
                          <span className="text-slate-400">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editing?.id === user.id ? (
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
                            onClick={() => handleEdit(user)}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            title="Edit user"
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
            <span>{state.total} total users</span>
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
                disabled={state.users.length < limit}
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
