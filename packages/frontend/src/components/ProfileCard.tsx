import { Card } from '@/components/ui/Card'
import { useAuth } from '@/contexts/auth-context'
import { Settings } from 'lucide-react'

const roleColors: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  parent: 'bg-blue-100 text-blue-700',
  student: 'bg-emerald-100 text-emerald-700',
}

const avatarColors: Record<string, string> = {
  admin: 'bg-purple-500',
  parent: 'bg-blue-500',
  student: 'bg-primary-500',
}

interface ProfileCardProps {
  onEditClick: () => void
}

export function ProfileCard({ onEditClick }: ProfileCardProps) {
  const { user } = useAuth()

  if (!user) return null

  const initials = (user.display_name ?? user.username ?? '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const roleClass = roleColors[user.role] ?? roleColors.student
  const avatarClass = avatarColors[user.role] ?? avatarColors.student

  return (
    <Card className="flex items-center gap-4 p-5">
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white ${avatarClass}`}
      >
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold text-slate-900">
          {user.display_name || user.username}
        </h2>
        <div className="mt-0.5 flex items-center gap-2">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${roleClass}`}
          >
            {user.role}
          </span>
          <span className="text-sm text-slate-500">{user.email}</span>
        </div>
      </div>

      <button
        onClick={onEditClick}
        className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label="Edit profile"
      >
        <Settings size={18} />
      </button>
    </Card>
  )
}
