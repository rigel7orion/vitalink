import { Router, type Response } from 'express'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { me, requireAuth, requireRole } from '../auth.js'
import { tx } from '../db.js'
import { conflict, forbidden, HttpError, notFound } from '../errors.js'
import { getDoctorByUser } from '../services/doctors.js'
import { chooseClinicPayment, getInvoice, getInvoiceByAppt, invoiceView, markPaid, type InvoiceRow } from '../services/billing.js'
import { charge } from '../services/payments.js'
import { buildInvoicePdf } from '../services/invoicePdf.js'
import { checkShare, shareLink } from '../services/share.js'
import { emailInvoice, secondsSinceEmail, webhookInvoice } from '../services/delivery.js'
import { getAppt } from './appointments.js'

// .strict(): anything beyond `method` (e.g. a card number) is rejected. Card data must never reach this server.
const Pay = z.object({ method: z.enum(['upi', 'card', 'netbanking', 'pay_at_clinic']) }).strict()

const EMAIL_COOLDOWN_S = 60
const STATUS_TEXT = { pending: 'payment pending', paid: 'paid', refunded: 'refunded', void: 'cancelled' } as const

export function invoiceRoutes({ db, cfg, now, mailer, authLimiter }: Ctx) {
  const r = Router()
  const deps = { db, cfg, mailer, now }

  /** Patient owns it, or it is the treating doctor's own appointment. */
  const mayView = (res: Parameters<typeof me>[0], inv: InvoiceRow) => {
    const u = me(res)
    if (u.role === 'patient') return inv.patient_id === u.id
    return getDoctorByUser(db, u.id)?.id === inv.doctor_id
  }
  const load = (res: Parameters<typeof me>[0], id: string) => {
    const inv = getInvoice(db, id)
    if (!inv) throw notFound('Invoice not found')
    if (!mayView(res, inv)) throw forbidden()
    return inv
  }

  /** After a successful online payment: email the receipt and ping the webhook. Fire-and-forget, never throws. */
  const afterPaid = async (id: string) => {
    try {
      const inv = getInvoice(db, id)
      if (!inv || inv.status !== 'paid') return
      const { url } = shareLink(linkBase(), cfg.jwtSecret, id, now(), cfg.shareTtlHours)
      await emailInvoice(deps, inv, await pdfFor(inv), url)
      await webhookInvoice(deps, 'invoice.paid', inv, url)
    } catch (e) {
      console.error('post-payment delivery failed:', e instanceof Error ? e.message : e)
    }
  }

  r.get('/invoices', requireAuth, (_req, res) => {
    const u = me(res)
    let rows: InvoiceRow[]
    if (u.role === 'patient') {
      rows = db.prepare('SELECT * FROM invoices WHERE patient_id = ? ORDER BY issued_at DESC').all(u.id) as unknown as InvoiceRow[]
    } else {
      const d = getDoctorByUser(db, u.id)
      rows = d ? (db.prepare('SELECT * FROM invoices WHERE doctor_id = ? ORDER BY issued_at DESC').all(d.id) as unknown as InvoiceRow[]) : []
    }
    res.json(rows.map(invoiceView))
  })

  // convenience: the bill for one appointment (what the booking screen needs)
  r.get('/appointments/:id/invoice', requireAuth, (req, res) => {
    const inv = getInvoiceByAppt(db, String(req.params.id))
    if (!inv) throw notFound('No invoice for this appointment')
    if (!mayView(res, inv)) throw forbidden()
    res.json(invoiceView(inv))
  })

  r.get('/invoices/:id', requireAuth, (req, res) => {
    res.json(invoiceView(load(res, String(req.params.id))))
  })

  r.post('/invoices/:id/pay', requireRole('patient'), (req, res) => {
    const inv = load(res, String(req.params.id))
    const { method } = Pay.parse(req.body)
    if (inv.status === 'paid') throw conflict('This invoice is already paid', 'already_paid')
    if (inv.status === 'refunded') throw conflict('This invoice was refunded', 'not_payable')
    if (inv.status === 'void') throw conflict('This appointment was cancelled, so nothing is due', 'not_payable')

    if (method === 'pay_at_clinic') {
      chooseClinicPayment(db, inv)
    } else {
      // charge first, then record: if the gateway throws, the invoice stays pending
      const { ref } = charge({ amountPaise: inv.total_paise, method, invoiceNo: inv.invoice_no })
      tx(db, () => markPaid(db, inv, method, ref, now()))
      void afterPaid(inv.id)
    }
    res.json(invoiceView(getInvoice(db, inv.id)!))
  })

  const pdfFor = async (inv: InvoiceRow) => {
    const a = getAppt(db, inv.appointment_id)
    if (!a) throw notFound('Appointment not found')
    return buildInvoicePdf(invoiceView(inv), {
      billing: cfg.billing,
      clinicOffsetMin: cfg.clinicOffsetMin,
      appointment: { bookingId: a.booking_id, token: a.token, start: a.start_ts, doctorName: a.doctor_name, specialty: a.specialty, room: a.room, reason: a.reason },
    })
  }
  const sendPdf = (res: Response, inv: InvoiceRow, pdf: Buffer, disposition: 'attachment' | 'inline') => {
    res.setHeader('content-type', 'application/pdf')
    res.setHeader('content-disposition', `${disposition}; filename="VITALINK-${inv.invoice_no.replaceAll('/', '-')}.pdf"`)
    res.setHeader('access-control-expose-headers', 'content-disposition')
    res.setHeader('content-length', String(pdf.length))
    res.end(pdf)
  }
  // links placed in emails / WhatsApp come from config, never from the request's Host header
  const linkBase = () => cfg.publicUrl ?? cfg.corsOrigin

  r.get('/invoices/:id/pdf', requireAuth, async (req, res) => {
    const inv = load(res, String(req.params.id))
    sendPdf(res, inv, await pdfFor(inv), 'attachment')
  })

  // Patient creates a signed, expiring link to share the invoice (WhatsApp / anywhere).
  r.post('/invoices/:id/share', requireRole('patient'), (req, res) => {
    const inv = load(res, String(req.params.id))
    const { url, expiresAt } = shareLink(linkBase(), cfg.jwtSecret, inv.id, now(), cfg.shareTtlHours)
    const text = `VITALINK invoice ${inv.invoice_no} (${STATUS_TEXT[inv.status]}): ${url}`
    res.json({ url, expiresAt, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}` })
  })

  // Email the invoice PDF to the patient's own address (60 s cooldown per invoice).
  r.post('/invoices/:id/email', requireRole('patient'), async (req, res) => {
    const inv = load(res, String(req.params.id))
    const since = secondsSinceEmail(deps, inv.id)
    if (since !== null && since < EMAIL_COOLDOWN_S) {
      res.setHeader('retry-after', String(Math.ceil(EMAIL_COOLDOWN_S - since)))
      throw new HttpError(429, 'Please wait a minute before sending again', 'rate_limited')
    }
    const { url } = shareLink(linkBase(), cfg.jwtSecret, inv.id, now(), cfg.shareTtlHours)
    const out = await emailInvoice(deps, inv, await pdfFor(inv), url)
    res.json({ status: out.status, to: out.to, configured: mailer !== null })
  })

  // Public (no login): the signed link opens the PDF. Rate-limited; signature is checked before expiry.
  r.get('/public/invoices/:id/pdf', authLimiter, async (req, res) => {
    const id = String(req.params.id)
    const check = checkShare(cfg.jwtSecret, id, Number(req.query.exp), String(req.query.sig ?? ''), now())
    if (check === 'bad') throw notFound('Invoice not found') // same answer as a missing invoice: reveals nothing
    if (check === 'expired') throw new HttpError(410, 'This link has expired. Ask for a new one.', 'link_expired')
    const inv = getInvoice(db, id)
    if (!inv) throw notFound('Invoice not found')
    res.setHeader('x-robots-tag', 'noindex')
    sendPdf(res, inv, await pdfFor(inv), 'inline')
  })

  return r
}
