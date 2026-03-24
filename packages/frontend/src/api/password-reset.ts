import { apiClient } from '@/lib/api-client'
import type { ApiResponse } from '@/types/api'

export interface ForgotPasswordInput {
  email: string
}

export interface ResetPasswordInput {
  selector: string
  validator: string
  newPassword: string
}

export function forgotPassword(
  data: ForgotPasswordInput,
): Promise<ApiResponse<{ message: string }>> {
  return apiClient.post('/api/auth/forgot-password', data)
}

export function resetPassword(
  data: ResetPasswordInput,
): Promise<ApiResponse<{ message: string }>> {
  return apiClient.post('/api/auth/reset-password', data)
}
