import type { ReactNode, HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`rounded-xl bg-white shadow-sm border border-slate-100 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
