import { apiClient } from '@/lib/api-client'
import type { ApiResponse, LoginResponse, User, InteractionDetails } from '@/types/api'

export interface RegisterInput {
  username: string
  email: string
  password: string
  displayName: string
  role?: 'student' | 'parent' | 'admin'
  turnstileToken?: string
}

export interface LoginInput {
  identifier: string
  password: string
  turnstileToken?: string
}

export interface GoogleAuthInput {
  token: string
  tokenType?: 'id_token' | 'access_token'
  turnstileToken?: string
}

export interface GoogleAuthResponse extends LoginResponse {
  isNewUser?: boolean
}

export function register(data: RegisterInput): Promise<ApiResponse<User>> {
  return apiClient.post('/api/auth/register', data)
}

export function login(data: LoginInput): Promise<ApiResponse<LoginResponse>> {
  const body = data.identifier.includes('@')
    ? { email: data.identifier, password: data.password, turnstileToken: data.turnstileToken }
    : { username: data.identifier, password: data.password, turnstileToken: data.turnstileToken }
  return apiClient.post('/api/auth/login', body)
}

export function googleAuth(data: GoogleAuthInput): Promise<ApiResponse<GoogleAuthResponse>> {
  return apiClient.post('/api/auth/google', data)
}

export function getInteractionDetails(uid: string): Promise<InteractionDetails> {
  return apiClient.get(`/api/auth/interaction/${uid}`)
}

export function submitInteractionLogin(uid: string, data: LoginInput): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/login`, data)
}

export function submitInteractionGoogle(
  uid: string,
  data: { token: string; tokenType: 'id_token' | 'access_token' },
): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/google`, data)
}

export function submitInteractionConsent(uid: string): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/confirm`)
}

export function abortInteraction(uid: string): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/abort`)
}
