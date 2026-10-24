import express from 'express'
import healthRouter from './routes/health.js'
import jobsRouter from './routes/jobs.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'

export function createApp() {
  const app = express()

  app.use(express.json({ limit: '1mb' }))

  app.use('/api/health', healthRouter)
  app.use('/api/jobs', jobsRouter)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
