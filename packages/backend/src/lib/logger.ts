import { env } from '../config/env.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export function createLogger(context: Record<string, unknown> = {}): Logger {
  const minLevel = LEVEL_PRIORITY[env.LOG_LEVEL] ?? LEVEL_PRIORITY.info

  const write = (level: LogLevel, message: string, data?: Record<string, unknown>): void => {
    if (LEVEL_PRIORITY[level] < minLevel) {
      return
    }

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
    debug: (message: string, data?: Record<string, unknown>) => write('debug', message, data),
    info: (message: string, data?: Record<string, unknown>) => write('info', message, data),
    warn: (message: string, data?: Record<string, unknown>) => write('warn', message, data),
    error: (message: string, data?: Record<string, unknown>) => write('error', message, data),
  }
}
