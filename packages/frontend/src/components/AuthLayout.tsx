import type { ReactNode } from 'react'
import { Logo } from '@/components/ui/Logo'
import { Card } from '@/components/ui/Card'

interface AuthLayoutProps {
  children: ReactNode
  title: string
  subtitle?: string
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Card className="w-full max-w-[420px] p-8 sm:p-10">
        <div className="mb-6 flex flex-col items-center" id="main-content">
          <Logo size="lg" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <main>{children}</main>
      </Card>
    </div>
  )
}
