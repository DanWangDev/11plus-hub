import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { HubUser } from '@/types/api'

interface AuthState {
  user: HubUser | null
  loading: boolean
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HubUser | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/auth/me', { credentials: 'include' })
      if (res.ok) {
        const body = (await res.json()) as { success: boolean; data?: HubUser }
        setUser(body.data ?? null)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchMe()
  }, [fetchMe])

  const logout = useCallback(() => {
    // GET /auth/logout — backend destroys session and redirects to OIDC end_session.
    // Uses navigation instead of form POST to avoid CSP form-action blocking
    // behind Cloudflare tunnel / reverse proxies.
    window.location.href = '/auth/logout'
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh: fetchMe }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
