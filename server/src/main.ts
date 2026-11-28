import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { consoleLogger } from './log.ts'

const config = loadConfig()
const app = createApp(config)
app.server.listen(config.port, '0.0.0.0', () => consoleLogger.info('listening', { port: config.port }))
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void app.close().then(() => process.exit(0)) })
