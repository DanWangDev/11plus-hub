import type { ApiResponse } from '@/types/api'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function getAuthHeaders(): Record<string, string> {
  const stored = localStorage.getItem('hub_user')
  if (stored) {
    try {
      const user = JSON.parse(stored) as { id: number }
      return { 'X-User-Id': String(user.id) }
    } catch {
      return {}
    }
  }
  return {}
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers,
    },
    ...options,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiResponse
    throw new ApiError(
      body.error ?? `Request failed with status ${response.status}`,
      response.status,
      body.code,
    )
  }

  return response.json() as Promise<T>
}

export const apiClient = {
  get: <T>(url: string, options?: RequestInit) => request<T>(url, { ...options, method: 'GET' }),

  post: <T>(url: string, body?: unknown, options?: RequestInit) =>
    request<T>(url, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(url: string, body?: unknown, options?: RequestInit) =>
    request<T>(url, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(url: string, options?: RequestInit) =>
    request<T>(url, { ...options, method: 'DELETE' }),
}
