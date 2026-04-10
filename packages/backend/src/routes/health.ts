import { Router } from 'express'
import { checkDbConnection } from '../db/connection.js'

export function createHealthRouter(options: { skipDbCheck?: boolean } = {}): Router {
  const router = Router()

  router.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'healthy',
        version: process.env.npm_package_version ?? '0.0.0',
        uptime: Math.floor(process.uptime()),
      },
    })
  })

  router.get('/api/ready', async (_req, res) => {
    if (options.skipDbCheck) {
      res.json({
        success: true,
        data: {
          status: 'ready',
          checks: { database: 'skipped' },
        },
      })
      return
    }

    const dbOk = await checkDbConnection()
    const status = dbOk ? 'ready' : 'not_ready'
    const statusCode = dbOk ? 200 : 503

    res.status(statusCode).json({
      success: dbOk,
      data: {
        status,
        checks: { database: dbOk ? 'ok' : 'fail' },
      },
    })
  })

  return router
}
