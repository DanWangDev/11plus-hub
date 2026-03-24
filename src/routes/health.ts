import { Router } from 'express'

export const healthRouter = Router()

healthRouter.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      version: process.env.npm_package_version ?? '0.0.0',
      uptime: Math.floor(process.uptime()),
    },
  })
})

healthRouter.get('/ready', (_req, res) => {
  // TODO: check database connectivity once DB is wired up
  res.json({
    success: true,
    data: {
      status: 'ready',
      checks: {
        database: 'skipped',
      },
    },
  })
})
