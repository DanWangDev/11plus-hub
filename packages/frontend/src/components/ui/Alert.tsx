import { AlertCircle, CheckCircle, Info } from 'lucide-react'
import type { ReactNode } from 'react'

interface AlertProps {
  variant: 'error' | 'success' | 'info'
  children: ReactNode
  className?: string
}

const variantConfig = {
  error: {
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-800',
    Icon: AlertCircle,
  },
  success: {
    bg: 'bg-green-50 border-green-200',
    text: 'text-green-800',
    Icon: CheckCircle,
  },
  info: {
    bg: 'bg-primary-50 border-primary-200',
    text: 'text-primary-800',
    Icon: Info,
  },
}

export function Alert({ variant, children, className = '' }: AlertProps) {
  const config = variantConfig[variant]
  const { Icon } = config

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        flex items-start gap-3 rounded-lg border p-3
        ${config.bg} ${config.text} ${className}
      `}
    >
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="text-sm">{children}</p>
    </div>
  )
}
