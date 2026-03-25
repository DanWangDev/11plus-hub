import { apiClient } from '@/lib/api-client'
import type { ApiResponse, LoginResponse, User, InteractionDetails } from '@/types/api'

export interface RegisterInput {
  username: string
  email: string
  password: string
  displayName: string
  role?: 'student' | 'parent' | 'admin'
}

export interface LoginInput {
  identifier: string
  password: string
}

export function register(data: RegisterInput): Promise<ApiResponse<User>> {
  return apiClient.post('/api/auth/register', data)
}

export function login(data: LoginInput): Promise<ApiResponse<LoginResponse>> {
  const body = data.identifier.includes('@')
    ? { email: data.identifier, password: data.password }
    : { username: data.identifier, password: data.password }
  return apiClient.post('/api/auth/login', body)
}

export function getInteractionDetails(uid: string): Promise<InteractionDetails> {
  return apiClient.get(`/api/auth/interaction/${uid}`)
}

export function submitInteractionLogin(uid: string, data: LoginInput): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/login`, data)
}

export function submitInteractionConsent(uid: string): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/confirm`)
}

export function abortInteraction(uid: string): Promise<ApiResponse> {
  return apiClient.post(`/api/auth/interaction/${uid}/abort`)
}
