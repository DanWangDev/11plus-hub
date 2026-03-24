import { render, type RenderOptions } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import type { ReactElement, ReactNode } from 'react'

function TestWrapper({ children }: { children: ReactNode }) {
  return <BrowserRouter>{children}</BrowserRouter>
}

function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { wrapper: TestWrapper, ...options })
}

export * from '@testing-library/react'
export { customRender as render }
