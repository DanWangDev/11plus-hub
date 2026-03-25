import { render, type RenderOptions } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { AuthProvider } from '@/contexts/auth-context'
import type { ReactElement, ReactNode } from 'react'

function TestWrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <BrowserRouter>{children}</BrowserRouter>
    </AuthProvider>
  )
}

function customRender(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: TestWrapper, ...options })
}

export * from '@testing-library/react'
export { customRender as render }
