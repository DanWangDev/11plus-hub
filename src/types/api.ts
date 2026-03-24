export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}

export interface HealthData {
  status: 'healthy' | 'degraded' | 'unhealthy'
  version: string
  uptime: number
}

export interface ReadyData {
  status: 'ready' | 'not_ready'
  checks: Record<string, 'ok' | 'fail' | 'skipped'>
}
