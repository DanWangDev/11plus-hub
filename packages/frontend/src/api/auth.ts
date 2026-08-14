import { apiClient } from '@/lib/api-client'
import type { ApiResponse, User, InteractionDetails } from '@/types/api'

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

export function register(data: RegisterInput): Promise<ApiResponse<User>> {
  return apiClient.post('/api/auth/register', data)
}

export function getInteractionDetails(uid: string): Promise<InteractionDetails> {
  return apiClient.get(`/api/auth/interaction/${uid}`)
}

export function submitInteractionLogin(uid: string, data: LoginInput): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/login`, data)
}

export function submitInteractionGoogle(
  uid: string,
  data: { token: string; tokenType: 'id_token'; turnstileToken?: string },
): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/google`, data)
}

export function submitInteractionConsent(uid: string): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/confirm`)
}

export function abortInteraction(uid: string): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/abort`)
}
