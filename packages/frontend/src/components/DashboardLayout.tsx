import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo } from '@/components/ui/Logo'
import { UserMenu } from '@/components/UserMenu'

interface DashboardLayoutProps {
  children: ReactNode
  onEditProfile?: () => void
}

export function DashboardLayout({ children, onEditProfile }: DashboardLayoutProps) {
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

          <UserMenu onEditProfile={() => onEditProfile?.()} />
        </nav>
      </header>

      <main id="main-content" className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  )
}
