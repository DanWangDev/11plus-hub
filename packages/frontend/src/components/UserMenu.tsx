import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { ChevronDown, UserPen, LayoutDashboard, LogOut } from 'lucide-react'

interface UserMenuProps {
  onEditProfile: () => void
}

export function UserMenu({ onEditProfile }: UserMenuProps) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpen(false), [])

  // Close on outside click
  useEffect(() => {
    if (!open) return

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, close])

  // Close on Escape
  useEffect(() => {
    if (!open) return

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, close])

  const initials = (user?.display_name ?? user?.username ?? '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div ref={menuRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="User menu"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-xs font-semibold text-white">
          {initials}
        </span>
        <span className="max-w-[120px] truncate">{user?.display_name ?? 'User'}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg shadow-slate-200/50 animate-in fade-in-0 zoom-in-95"
        >
          <MenuButton
            icon={<UserPen size={16} />}
            label="Edit profile"
            onClick={() => {
              close()
              onEditProfile()
            }}
          />
          <MenuLink icon={<LayoutDashboard size={16} />} label="App dashboard" href="/dashboard" />
          <div className="my-1 border-t border-slate-100" />
          <MenuButton
            icon={<LogOut size={16} />}
            label="Sign out"
            onClick={() => {
              close()
              logout()
            }}
            variant="danger"
          />
        </div>
      )}
    </div>
  )
}

function MenuButton({
  icon,
  label,
  onClick,
  variant = 'default',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  variant?: 'default' | 'danger'
}) {
  const colorClass =
    variant === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'

  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors ${colorClass}`}
    >
      <span className="shrink-0 text-current/70">{icon}</span>
      {label}
    </button>
  )
}

function MenuLink({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <a
      role="menuitem"
      href={href}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
    >
      <span className="shrink-0 text-current/70">{icon}</span>
      {label}
    </a>
  )
}
