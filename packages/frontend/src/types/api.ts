export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
  redirectTo?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}

export interface User {
  id: number
  username: string
  email: string
  display_name: string
  role: 'student' | 'parent' | 'admin'
  parent_id: number | null
  google_id: string | null
  email_verified: boolean
  created_at: string
  updated_at: string
}

export interface LoginResponse {
  user: User
  token: string
}

export interface Application {
  id: number
  name: string
  slug: string
  url: string
  client_id: string
  redirect_uris: string[]
  icon_url: string | null
  stats_api_url: string | null
  status: string
  created_at: string
}

export interface UserAppAccess {
  user_id: number
  app_id: number
  granted_at: string
  app_name?: string
  app_slug?: string
  app_url?: string
  app_icon_url?: string | null
}

export interface InteractionDetails {
  prompt: {
    name: 'login' | 'consent'
    details?: Record<string, unknown>
  }
  params: {
    client_id?: string
    scope?: string
    redirect_uri?: string
  }
  session?: {
    accountId?: string
  }
  uid: string
  client?: {
    name?: string
  }
}

/** OIDC claims from /auth/me (cookie-backed session) */
export interface HubUser {
  sub: string
  username: string
  display_name: string
  email: string
  email_verified: boolean
  role: string
  plan: string
  features: string[]
  apps: string[]
  has_password: boolean
  expires_at: string | null
}

export interface PasswordResetRequest {
  email: string
}

export interface PasswordResetConfirm {
  selector: string
  validator: string
  newPassword: string
}
