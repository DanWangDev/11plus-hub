import postgres from 'postgres'
import { env } from '../config/env.js'

export interface DbConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  max?: number
  idleTimeout?: number
  connectTimeout?: number
}

function getDbConfig(): DbConfig {
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL)
    return {
      host: url.hostname,
      port: Number(url.port) || 5432,
      database: url.pathname.slice(1),
      username: url.username,
      password: url.password,
    }
  }

  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
  }
}

export function createDb(config?: Partial<DbConfig>): postgres.Sql {
  const dbConfig = { ...getDbConfig(), ...config }

  return postgres({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    username: dbConfig.username,
    password: dbConfig.password,
    max: dbConfig.max ?? 10,
    idle_timeout: dbConfig.idleTimeout ?? 20,
    connect_timeout: dbConfig.connectTimeout ?? 10,
    transform: {
      undefined: null,
    },
  })
}

export const db = createDb()

export async function checkDbConnection(sql: postgres.Sql = db): Promise<boolean> {
  try {
    const result = await sql`SELECT 1 AS ok`
    return result[0]?.ok === 1
  } catch {
    return false
  }
}

export async function closeDb(sql: postgres.Sql = db): Promise<void> {
  await sql.end()
}
