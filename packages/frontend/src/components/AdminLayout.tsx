import { useState, useCallback, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Menu, X, LogOut, Users, AppWindow, CreditCard, ScrollText } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { useAuth } from '@/contexts/auth-context'

const navItems = [
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/apps', label: 'Apps', icon: AppWindow },
  { to: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { to: '/admin/audit', label: 'Audit Log', icon: ScrollText },
]

interface AdminLayoutProps {
  children: ReactNode
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const { user, logout } = useAuth()

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => !prev)
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <header className="border-b border-slate-200 bg-white" role="banner">
        <nav
          className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3"
          aria-label="Admin navigation"
        >
          <div className="flex items-center gap-8">
            <Link to="/admin" aria-label="Go to admin dashboard">
              <Logo size="md" />
            </Link>

            <div className="hidden items-center gap-1 md:flex" role="navigation">
              {navItems.map(({ to, label, icon: Icon }) => {
                const active = location.pathname.startsWith(to)
                return (
                  <Link
                    key={to}
                    to={to}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {label}
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="hidden items-center gap-4 md:flex">
            <span className="text-sm text-slate-600">{user?.display_name ?? 'Admin'}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Sign out"
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>

          <button
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden"
            onClick={toggleMenu}
            aria-expanded={menuOpen}
            aria-controls="admin-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </nav>

        {menuOpen && (
          <div id="admin-mobile-menu" className="border-t border-slate-100 px-4 py-3 md:hidden">
            <div className="space-y-1">
              {navItems.map(({ to, label, icon: Icon }) => {
                const active = location.pathname.startsWith(to)
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                      active
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {label}
                  </Link>
                )
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-sm text-slate-600">{user?.display_name ?? 'Admin'}</span>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
              >
                <LogOut size={16} aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      <main id="main-content" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </div>
  )
}
