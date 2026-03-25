import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { User } from '@/types/api'

interface AuthState {
  user: User | null
  setUser: (user: User | null) => void
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('hub_user')
    return stored ? (JSON.parse(stored) as User) : null
  })

  const handleSetUser = useCallback((u: User | null) => {
    setUser(u)
    if (u) {
      localStorage.setItem('hub_user', JSON.stringify(u))
    } else {
      localStorage.removeItem('hub_user')
    }
  }, [])

  const logout = useCallback(() => {
    handleSetUser(null)
    localStorage.removeItem('hub_token')
  }, [handleSetUser])

  return (
    <AuthContext.Provider value={{ user, setUser: handleSetUser, logout }}>
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
