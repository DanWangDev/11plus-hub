interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'light'
  className?: string
}

const sizeClasses = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
}

export function Logo({ size = 'md', variant = 'default', className = '' }: LogoProps) {
  const isLight = variant === 'light'

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className={`
          flex items-center justify-center rounded-lg font-bold
          ${isLight ? 'bg-white/20 text-white' : 'bg-primary-500 text-white'}
          ${sizeClasses[size]}
        `}
        aria-hidden="true"
      >
        F
      </div>
      <span className={`text-lg font-semibold ${isLight ? 'text-white' : 'text-slate-900'}`}>
        Lab F
      </span>
    </div>
  )
}
