import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider, useAuth } from '@/contexts/auth-context'
import { ImpersonationBanner } from '@/components/ImpersonationBanner'
import { LoginPage } from '@/pages/LoginPage'
import { SignupPage } from '@/pages/SignupPage'
import { InteractionPage } from '@/pages/InteractionPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PricingPage } from '@/pages/PricingPage'
import { AdminDashboardPage } from '@/pages/admin/AdminDashboardPage'
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage'
import { AdminAppsPage } from '@/pages/admin/AdminAppsPage'
import { AdminSubscriptionsPage } from '@/pages/admin/AdminSubscriptionsPage'
import { AdminAuditPage } from '@/pages/admin/AdminAuditPage'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  // Block admin routes during impersonation
  if (user?.impersonatedBy) {
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}

function ImpersonationLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const isImpersonating = Boolean(user?.impersonatedBy)

  return (
    <>
      <ImpersonationBanner />
      <div className={isImpersonating ? 'pt-10' : ''}>{children}</div>
    </>
  )
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <ImpersonationLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/interaction/:uid" element={<InteractionPage />} />

          {/* Admin routes — blocked during impersonation */}
          <Route path="/admin" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
          <Route path="/admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
          <Route path="/admin/apps" element={<AdminRoute><AdminAppsPage /></AdminRoute>} />
          <Route path="/admin/subscriptions" element={<AdminRoute><AdminSubscriptionsPage /></AdminRoute>} />
          <Route path="/admin/audit" element={<AdminRoute><AdminAuditPage /></AdminRoute>} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ImpersonationLayout>
    </BrowserRouter>
  )
}

export function App() {
  const inner = (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )

  if (GOOGLE_CLIENT_ID) {
    return <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{inner}</GoogleOAuthProvider>
  }

  return inner
}
