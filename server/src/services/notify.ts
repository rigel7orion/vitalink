import { randomUUID } from 'node:crypto'
import type { DB } from '../db.js'
import type { Config } from '../config.js'

export interface Recipient {
  type: 'doctor' | 'family'
  name: string
  ref: string // doctor user id, or family phone number
}

/**
 * Records one notification row per recipient and, if NOTIFY_WEBHOOK_URL is configured,
 * POSTs the alert there (plug SMS / WhatsApp / push in behind that URL).
 * Without a webhook the channel is "log": the row is stored and shown in the app only.
 */
export function dispatch(
  db: DB,
  cfg: Config,
  alert: { id: string; kind: string; severity: string; message: string; patientName: string },
  recipients: Recipient[],
) {
  const channel = cfg.notifyWebhook ? 'webhook' : 'log'
  const ins = db.prepare(
    'INSERT INTO notifications (id,alert_id,recipient_type,recipient_name,recipient_ref,channel,status,created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
  const upd = db.prepare('UPDATE notifications SET status = ? WHERE id = ?')
  const out = recipients.map((r) => {
    const id = randomUUID()
    ins.run(id, alert.id, r.type, r.name, r.ref, channel, cfg.notifyWebhook ? 'pending' : 'logged', Date.now())
    return { id, ...r, channel }
  })
  if (cfg.notifyWebhook) {
    for (const n of out) {
      fetch(cfg.notifyWebhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alert, recipient: { type: n.type, name: n.name, ref: n.ref } }),
        signal: AbortSignal.timeout(4000),
      })
        .then((r) => upd.run(r.ok ? 'sent' : 'failed', n.id))
        .catch(() => upd.run('failed', n.id))
    }
  }
  return out.map((n) => ({ type: n.type, name: n.name, channel: n.channel }))
}
