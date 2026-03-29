import { useState, useCallback, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Menu, X, LogOut } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { useAuth } from '@/contexts/auth-context'

interface DashboardLayoutProps {
  children: ReactNode
  onEditProfile?: () => void
}

export function DashboardLayout({ children, onEditProfile }: DashboardLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { user, logout } = useAuth()

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => !prev)
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <header className="bg-gradient-to-r from-primary-700 to-primary-500 shadow-sm" role="banner">
        <nav
          className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3"
          aria-label="Main navigation"
        >
          <Link to="/dashboard" aria-label="Go to dashboard">
            <Logo size="md" variant="light" />
          </Link>

          <div className="hidden items-center gap-4 sm:flex">
            <button
              onClick={onEditProfile}
              className="text-sm text-white/80 hover:text-white hover:underline"
              aria-label="Edit profile"
            >
              {user?.display_name ?? 'User'}
            </button>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Sign out"
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>

          <button
            className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white sm:hidden"
            onClick={toggleMenu}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </nav>

        {menuOpen && (
          <div id="mobile-menu" className="border-t border-white/20 px-4 py-3 sm:hidden">
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  setMenuOpen(false)
                  onEditProfile?.()
                }}
                className="text-sm text-white/80 hover:text-white hover:underline"
                aria-label="Edit profile"
              >
                {user?.display_name ?? 'User'}
              </button>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white"
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
