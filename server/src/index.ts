import { createApp } from './app.js'
import { DEMO } from './db.js'

const { app, cfg, close } = createApp()

const server = app.listen(cfg.port, () => {
  console.log(`VITALINK API listening on http://localhost:${cfg.port}/api  (db: ${cfg.dbPath})`)
  if (cfg.seed) {
    console.log(`Dev seed: patient ${DEMO.patient.email} / ${DEMO.patient.password}; doctors doctor1..8@vitalink.test / ${DEMO.doctorPassword}`)
  }
  if (!cfg.notifyWebhook) console.log('Alert delivery: log only (set NOTIFY_WEBHOOK_URL to push alerts to SMS/WhatsApp/etc).')
})

const stop = () => {
  server.close(() => {
    close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
