import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import { requestId } from './middleware/request-id.js'
import { notFoundHandler, errorHandler } from './middleware/error-handler.js'
import { healthRouter } from './routes/health.js'

export function createApp(): express.Express {
  const app = express()

  // Security & parsing
  app.use(helmet())
  app.use(cors())
  app.use(compression())
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))

  // Request ID tracking
  app.use(requestId)

  // Routes
  app.use(healthRouter)

  // Error handling
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
