import { apiClient } from '@/lib/api-client'
import type { ApiResponse, Application, UserAppAccess } from '@/types/api'

export function listApplications(): Promise<
  ApiResponse<Application[]>
> {
  return apiClient.get('/api/apps')
}

export function getUserEntitlements(
  userId: number,
): Promise<ApiResponse<UserAppAccess[]>> {
  return apiClient.get(`/api/users/${userId}/entitlements`)
}
