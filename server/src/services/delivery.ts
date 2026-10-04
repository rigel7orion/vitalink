import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import type { DB } from '../db.js'
import { invoiceView, rupees, type InvoiceRow } from './billing.js'

export interface MailOptions {
  from: string
  to: string
  subject: string
  text: string
  html: string
  attachments?: { filename: string; content: Buffer; contentType: string }[]
}
/** Anything with sendMail (a real SMTP transport, or a test double). */
export interface Mailer {
  sendMail(o: MailOptions): Promise<unknown>
}

/**
 * SMTP via nodemailer, loaded lazily so the server runs (and tests pass) even if the package
 * is not installed. Install it with `npm --prefix server i nodemailer` and set SMTP_URL.
 */
export function smtpMailer(url: string): Mailer {
  let t: Mailer | undefined
  return {
    async sendMail(o) {
      if (!t) {
        const name = 'nodemailer' // variable specifier: no compile-time dependency
        const mod = (await import(name)) as { default: { createTransport(u: string): Mailer } }
        t = mod.default.createTransport(url)
      }
      return t.sendMail(o)
    },
  }
}

export interface DeliveryDeps {
  db: DB
  cfg: Config
  mailer: Mailer | null
  now: () => number
}
export type DeliveryStatus = 'sent' | 'logged' | 'failed'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const STATUS_TEXT = { pending: 'Payment pending', paid: 'Paid', refunded: 'Refunded', void: 'Cancelled' } as const

function record(d: DeliveryDeps, invoiceId: string, channel: 'email' | 'webhook', recipient: string, status: DeliveryStatus, error?: string) {
  d.db
    .prepare('INSERT INTO invoice_deliveries (id,invoice_id,channel,recipient,status,error,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(randomUUID(), invoiceId, channel, recipient, status, error ? error.slice(0, 300) : null, d.now())
}

/** Seconds since the last email attempt for this invoice, or null if none (used as a cooldown). */
export function secondsSinceEmail(d: DeliveryDeps, invoiceId: string): number | null {
  const r = d.db.prepare(`SELECT MAX(created_at) AS t FROM invoice_deliveries WHERE invoice_id = ? AND channel = 'email'`).get(invoiceId) as { t: number | null }
  return r.t == null ? null : (d.now() - r.t) / 1000
}

/** Email the invoice (PDF attached) to the patient's own address. Never throws; always records the outcome. */
export async function emailInvoice(d: DeliveryDeps, inv: InvoiceRow, pdf: Buffer, link: string): Promise<{ status: DeliveryStatus; to: string }> {
  const to = inv.patient_email
  const v = invoiceView(inv)
  const state = STATUS_TEXT[inv.status]
  const days = Math.max(1, Math.round(d.cfg.shareTtlHours / 24))
  const text = [
    `Hi ${inv.patient_name},`,
    '',
    `Your VITALINK invoice ${inv.invoice_no} is attached. Status: ${state}.`,
    ...v.lines.map((l) => `  ${l.description}: ${rupees(l.amountPaise + l.taxPaise)}`),
    `Total: ${rupees(inv.total_paise)}`,
    '',
    `You can also open it here (valid ${days} days): ${link}`,
    '',
    'VITALINK',
  ].join('\n')
  const html = `<div style="font-family:Arial,sans-serif;color:#0b1f2a;max-width:520px">
<h2 style="margin:0 0 8px">Your VITALINK invoice</h2>
<p>Hi ${esc(inv.patient_name)}, invoice <b>${esc(inv.invoice_no)}</b> is attached. Status: <b>${state}</b>.</p>
<table style="width:100%;border-collapse:collapse">${v.lines
    .map((l) => `<tr><td style="padding:4px 0">${esc(l.description)}</td><td style="text-align:right">${esc(rupees(l.amountPaise + l.taxPaise))}</td></tr>`)
    .join('')}
<tr><td style="padding-top:8px;border-top:1px solid #ccd"><b>Total</b></td><td style="text-align:right;border-top:1px solid #ccd"><b>${esc(rupees(inv.total_paise))}</b></td></tr></table>
<p><a href="${esc(link)}">Open invoice PDF</a> (link valid ${days} days)</p></div>`

  if (!d.mailer) {
    console.log(`[mail:not-configured] would email ${to}: invoice ${inv.invoice_no} (${state})`)
    record(d, inv.id, 'email', to, 'logged')
    return { status: 'logged', to }
  }
  try {
    await d.mailer.sendMail({
      from: d.cfg.mailFrom,
      to,
      subject: `VITALINK invoice ${inv.invoice_no} (${state})`,
      text,
      html,
      attachments: [{ filename: `VITALINK-${inv.invoice_no.replaceAll('/', '-')}.pdf`, content: pdf, contentType: 'application/pdf' }],
    })
    record(d, inv.id, 'email', to, 'sent')
    return { status: 'sent', to }
  } catch (e) {
    record(d, inv.id, 'email', to, 'failed', e instanceof Error ? e.message : String(e))
    return { status: 'failed', to }
  }
}

/** POST a small JSON event to INVOICE_WEBHOOK_URL (bridge to WhatsApp / n8n / Zapier). Never throws. */
export async function webhookInvoice(d: DeliveryDeps, event: 'invoice.paid', inv: InvoiceRow, link: string): Promise<DeliveryStatus | null> {
  const url = d.cfg.invoiceWebhook
  if (!url) return null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, invoiceNo: inv.invoice_no, patient: { name: inv.patient_name, email: inv.patient_email }, totalPaise: inv.total_paise, status: inv.status, pdfUrl: link }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`webhook ${res.status}`)
    record(d, inv.id, 'webhook', new URL(url).host, 'sent')
    return 'sent'
  } catch (e) {
    record(d, inv.id, 'webhook', 'webhook', 'failed', e instanceof Error ? e.message : String(e))
    return 'failed'
  }
}
