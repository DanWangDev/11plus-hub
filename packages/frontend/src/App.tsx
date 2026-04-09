import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider } from '@/contexts/auth-context'
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

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/interaction/:uid" element={<InteractionPage />} />

        {/* Admin routes */}
        <Route path="/admin" element={<AdminDashboardPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/apps" element={<AdminAppsPage />} />
        <Route path="/admin/subscriptions" element={<AdminSubscriptionsPage />} />
        <Route path="/admin/audit" element={<AdminAuditPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
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
