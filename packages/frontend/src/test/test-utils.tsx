import { render, type RenderOptions } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider } from '@/contexts/auth-context'
import type { ReactElement, ReactNode } from 'react'

function TestWrapper({ children }: { children: ReactNode }) {
  return (
    <GoogleOAuthProvider clientId="test-client-id">
      <AuthProvider>
        <BrowserRouter>{children}</BrowserRouter>
      </AuthProvider>
    </GoogleOAuthProvider>
  )
}

function customRender(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: TestWrapper, ...options })
}

export * from '@testing-library/react'
export { customRender as render }
