import { apiClient } from '@/lib/api-client'
import type { ApiResponse, User, Application } from '@/types/api'

// Users
export function listUsers(params?: {
  page?: number
  limit?: number
  role?: string
  search?: string
}): Promise<ApiResponse<User[]>> {
  const query = new URLSearchParams()
  if (params?.page) query.set('page', String(params.page))
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.role) query.set('role', params.role)
  if (params?.search) query.set('search', params.search)
  const qs = query.toString()
  return apiClient.get(`/api/users${qs ? `?${qs}` : ''}`)
}

export function getUser(id: number): Promise<ApiResponse<User>> {
  return apiClient.get(`/api/users/${id}`)
}

export function createUser(data: {
  username: string
  email: string
  password?: string
  displayName: string
  role?: string
}): Promise<ApiResponse<User>> {
  return apiClient.post('/api/users', data)
}

export function updateUser(
  id: number,
  data: Partial<Pick<User, 'display_name' | 'email' | 'role'>>,
): Promise<ApiResponse<User>> {
  return apiClient.patch(`/api/users/${id}`, data)
}

export function deleteUser(id: number): Promise<ApiResponse<User>> {
  return apiClient.delete(`/api/users/${id}`)
}

// Applications
export function createApplication(data: {
  name: string
  slug: string
  url: string
  redirect_uris: string[]
}): Promise<ApiResponse<Application & { client_secret?: string }>> {
  return apiClient.post('/api/apps', data)
}

export function getApplication(id: number): Promise<ApiResponse<Application>> {
  return apiClient.get(`/api/apps/${id}`)
}

export function updateApplication(
  id: number,
  data: Partial<Pick<Application, 'name' | 'url' | 'redirect_uris' | 'status'>>,
): Promise<ApiResponse<Application>> {
  return apiClient.patch(`/api/apps/${id}`, data)
}

export function deleteApplication(id: number): Promise<ApiResponse<Application>> {
  return apiClient.delete(`/api/apps/${id}`)
}

export function rotateClientSecret(
  id: number,
): Promise<ApiResponse<Application & { client_secret: string }>> {
  return apiClient.post(`/api/apps/${id}/rotate-secret`)
}

// Subscriptions
export interface Subscription {
  id: number
  user_id: number
  plan: string
  status: string
  features: string[]
  expires_at: string | null
  assigned_by: number | null
  created_at: string
  username?: string
  email?: string
}

export function listSubscriptions(params?: {
  page?: number
  limit?: number
  plan?: string
  status?: string
}): Promise<ApiResponse<Subscription[]>> {
  const query = new URLSearchParams()
  if (params?.page) query.set('page', String(params.page))
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.plan) query.set('plan', params.plan)
  if (params?.status) query.set('status', params.status)
  const qs = query.toString()
  return apiClient.get(`/api/subscriptions${qs ? `?${qs}` : ''}`)
}

export function createSubscription(data: {
  userId: number
  plan: string
  status?: string
}): Promise<ApiResponse<Subscription>> {
  return apiClient.post('/api/subscriptions', data)
}

export function updateSubscription(
  id: number,
  data: Partial<Pick<Subscription, 'plan' | 'status' | 'features'>>,
): Promise<ApiResponse<Subscription>> {
  return apiClient.patch(`/api/subscriptions/${id}`, data)
}

export function cancelSubscription(id: number): Promise<ApiResponse<Subscription>> {
  return apiClient.delete(`/api/subscriptions/${id}`)
}

// Audit Log
export interface AuditEntry {
  id: number
  actor_id: number | null
  action: string
  target_id: number | null
  details: Record<string, unknown>
  ip_address: string | null
  created_at: string
  actor_username?: string | null
}

export function listAuditLog(params?: {
  page?: number
  limit?: number
  action?: string
  actor_id?: number
}): Promise<ApiResponse<AuditEntry[]>> {
  const query = new URLSearchParams()
  if (params?.page) query.set('page', String(params.page))
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.action) query.set('action', params.action)
  if (params?.actor_id) query.set('actor_id', String(params.actor_id))
  const qs = query.toString()
  return apiClient.get(`/api/audit${qs ? `?${qs}` : ''}`)
}
