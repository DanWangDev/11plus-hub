import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import { requestId } from './middleware/request-id.js'
import { notFoundHandler, errorHandler } from './middleware/error-handler.js'
import { createHealthRouter } from './routes/health.js'

export interface AppOptions {
  skipDbCheck?: boolean
}

export function createApp(options: AppOptions = {}): express.Express {
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
  app.use(createHealthRouter({ skipDbCheck: options.skipDbCheck }))

  // Error handling
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
