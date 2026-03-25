import { useState, useCallback, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { Menu, X, LogOut } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { useAuth } from '@/contexts/auth-context'

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => !prev)
  }, [])

  const handleSignOut = useCallback(() => {
    logout()
    navigate('/login')
  }, [logout, navigate])

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <header className="border-b border-slate-200 bg-white" role="banner">
        <nav
          className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3"
          aria-label="Main navigation"
        >
          <Link to="/dashboard" aria-label="Go to dashboard">
            <Logo size="md" />
          </Link>

          <div className="hidden items-center gap-4 sm:flex">
            <span className="text-sm text-slate-600">{user?.display_name ?? 'User'}</span>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Sign out"
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>

          <button
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 sm:hidden"
            onClick={toggleMenu}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </nav>

        {menuOpen && (
          <div id="mobile-menu" className="border-t border-slate-100 px-4 py-3 sm:hidden">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">{user?.display_name ?? 'User'}</span>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
              >
                <LogOut size={16} aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      <main id="main-content" className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  )
}
