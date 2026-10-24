import { createApp } from './app.js'
import { initDb } from './db.js'

const PORT = Number(process.env.PORT) || 4000
const HOST = process.env.HOST || '127.0.0.1'

initDb()

const app = createApp()

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`JobTrack API 运行于 http://${HOST}:${PORT}`)
})
