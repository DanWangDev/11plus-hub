import { createApp } from './app.js'
import { env } from './config/env.js'

const app = createApp()

app.listen(env.PORT, env.HOST, () => {
  if (env.NODE_ENV !== 'test') {
    process.stdout.write(`Hub server running on http://${env.HOST}:${env.PORT}\n`)
    process.stdout.write(`Environment: ${env.NODE_ENV}\n`)
  }
})
