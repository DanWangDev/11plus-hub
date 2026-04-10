export interface Logger {
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
}

export function createLogger(context: Record<string, unknown> = {}): Logger {
  const write = (level: string, message: string, data?: Record<string, unknown>): void => {
    const entry = {
      level,
      message,
      ts: new Date().toISOString(),
      ...context,
      ...data,
    }
    process.stdout.write(JSON.stringify(entry) + '\n')
  }

  return {
    info: (message: string, data?: Record<string, unknown>) => write('info', message, data),
    warn: (message: string, data?: Record<string, unknown>) => write('warn', message, data),
    error: (message: string, data?: Record<string, unknown>) => write('error', message, data),
  }
}
