import type { ReactNode, HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl bg-white shadow-sm shadow-slate-200/50 border border-slate-100 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
