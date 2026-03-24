import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  loading?: boolean
  children: ReactNode
}

const variantClasses: Record<string, string> = {
  primary:
    'bg-primary-500 text-white hover:bg-primary-600 focus:ring-primary-300',
  secondary:
    'bg-slate-100 text-slate-700 hover:bg-slate-200 focus:ring-slate-300',
  danger:
    'bg-red-500 text-white hover:bg-red-600 focus:ring-red-300',
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2
        rounded-lg px-4 py-3 text-sm font-semibold
        transition-colors duration-150
        focus:outline-none focus:ring-2 focus:ring-offset-2
        disabled:cursor-not-allowed disabled:opacity-60
        min-h-[44px]
        ${variantClasses[variant] ?? variantClasses.primary}
        ${className}
      `}
      disabled={isDisabled}
      {...props}
    >
      {loading && (
        <Loader2
          className="animate-spin"
          size={16}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  )
}
