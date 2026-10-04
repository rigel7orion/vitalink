import { randomUUID } from 'node:crypto'
import type { BillingConfig } from '../config.js'
import type { DB } from '../db.js'
import { clinicHourMinute } from '../time.js'

/* All money is integer PAISE (1 rupee = 100 paise) so totals never drift from float rounding. */

export type InvoiceStatus = 'pending' | 'paid' | 'refunded' | 'void'
export type PayMethod = 'upi' | 'card' | 'netbanking' | 'pay_at_clinic'

export interface Line {
  description: string
  qty: number
  unitPaise: number
  amountPaise: number
  taxPct: number
  taxPaise: number
}

export interface InvoiceRow {
  id: string
  invoice_no: string
  appointment_id: string
  patient_id: string
  doctor_id: string
  status: InvoiceStatus
  lines: string
  subtotal_paise: number
  tax_paise: number
  total_paise: number
  patient_name: string
  patient_email: string
  issued_at: number
  payment_method: PayMethod | null
  payment_ref: string | null
  paid_at: number | null
  refund_paise: number
  credit_note_no: string | null
  refunded_at: number | null
}

/** Consultation + platform fee, each with its own GST rate. Tax is rounded per line, half-up. */
export function computeBill(consultFeeRupees: number, doctorName: string, specialty: string, cfg: BillingConfig) {
  const mk = (description: string, unitPaise: number, taxPct: number): Line => ({
    description,
    qty: 1,
    unitPaise,
    amountPaise: unitPaise,
    taxPct,
    taxPaise: Math.round((unitPaise * taxPct) / 100),
  })
  const lines: Line[] = [mk(`Consultation: ${doctorName} (${specialty})`, Math.round(consultFeeRupees * 100), cfg.consultGstPct)]
  if (cfg.platformFeePaise > 0) lines.push(mk('Platform & booking fee', cfg.platformFeePaise, cfg.platformGstPct))
  const subtotal = lines.reduce((s, l) => s + l.amountPaise, 0)
  const tax = lines.reduce((s, l) => s + l.taxPaise, 0)
  return { lines, subtotalPaise: subtotal, taxPaise: tax, totalPaise: subtotal + tax }
}

/** Indian financial year tag, e.g. 1 Oct 2026 -> "2627" (FY runs April to March). */
export function fiscalTag(ms: number, offsetMin: number): string {
  const d = new Date(ms + offsetMin * 60_000)
  const y = d.getUTCFullYear()
  const start = d.getUTCMonth() >= 3 ? y : y - 1
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`
}

/** Next number in a sequence. MUST be called inside the booking transaction so a rolled-back booking leaves no gap. */
function nextSeq(db: DB, key: string): number {
  db.prepare('INSERT INTO counters (key, n) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1').run(key)
  return (db.prepare('SELECT n FROM counters WHERE key = ?').get(key) as { n: number }).n
}
const fmtNo = (prefix: string, tag: string, n: number) => `${prefix}/${tag}/${String(n).padStart(6, '0')}`

export function createInvoice(
  db: DB,
  cfg: { billing: BillingConfig; clinicOffsetMin: number },
  a: { appointmentId: string; patientId: string; patientName: string; patientEmail: string; doctorId: string; doctorName: string; specialty: string; feeRupees: number },
  nowMs: number,
): InvoiceRow {
  const bill = computeBill(a.feeRupees, a.doctorName, a.specialty, cfg.billing)
  const tag = fiscalTag(nowMs, cfg.clinicOffsetMin)
  const invoiceNo = fmtNo('VL', tag, nextSeq(db, `inv:${tag}`))
  const id = randomUUID()
  db.prepare(
    `INSERT INTO invoices (id,invoice_no,appointment_id,patient_id,doctor_id,status,lines,subtotal_paise,tax_paise,total_paise,patient_name,patient_email,issued_at)
     VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?,?)`,
  ).run(id, invoiceNo, a.appointmentId, a.patientId, a.doctorId, JSON.stringify(bill.lines), bill.subtotalPaise, bill.taxPaise, bill.totalPaise, a.patientName, a.patientEmail, nowMs)
  return getInvoice(db, id)!
}

export const getInvoice = (db: DB, id: string) =>
  db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as unknown as InvoiceRow | undefined
export const getInvoiceByAppt = (db: DB, appointmentId: string) =>
  db.prepare('SELECT * FROM invoices WHERE appointment_id = ?').get(appointmentId) as unknown as InvoiceRow | undefined

export function markPaid(db: DB, inv: InvoiceRow, method: PayMethod, ref: string, nowMs: number) {
  db.prepare(`UPDATE invoices SET status='paid', payment_method=?, payment_ref=?, paid_at=? WHERE id=? AND status='pending'`).run(method, ref, nowMs, inv.id)
}

/** Patient will settle at the clinic: stays pending, but we remember the choice. */
export function chooseClinicPayment(db: DB, inv: InvoiceRow) {
  db.prepare(`UPDATE invoices SET payment_method='pay_at_clinic' WHERE id=? AND status='pending'`).run(inv.id)
}

/**
 * Appointment was cancelled. Paid invoices are refunded in full with a credit note;
 * unpaid ones are voided. Call inside the same transaction as the cancellation.
 */
export function settleOnCancel(db: DB, cfg: { clinicOffsetMin: number }, appointmentId: string, nowMs: number) {
  const inv = getInvoiceByAppt(db, appointmentId)
  if (!inv) return
  if (inv.status === 'paid') {
    const tag = fiscalTag(nowMs, cfg.clinicOffsetMin)
    const cn = fmtNo('CN', tag, nextSeq(db, `cn:${tag}`))
    db.prepare(`UPDATE invoices SET status='refunded', refund_paise=?, credit_note_no=?, refunded_at=? WHERE id=?`).run(inv.total_paise, cn, nowMs, inv.id)
  } else if (inv.status === 'pending') {
    db.prepare(`UPDATE invoices SET status='void' WHERE id=?`).run(inv.id)
  }
}

/** Doctor marked the visit complete: a pay-at-clinic bill is now settled in cash. */
export function settleClinicCash(db: DB, appointmentId: string, nowMs: number, ref: string) {
  const inv = getInvoiceByAppt(db, appointmentId)
  if (inv && inv.status === 'pending' && inv.payment_method === 'pay_at_clinic') markPaid(db, inv, 'pay_at_clinic', ref, nowMs)
}

export function invoiceView(r: InvoiceRow) {
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    appointmentId: r.appointment_id,
    status: r.status,
    currency: 'INR' as const,
    lines: JSON.parse(r.lines) as Line[],
    subtotalPaise: r.subtotal_paise,
    taxPaise: r.tax_paise,
    totalPaise: r.total_paise,
    billedTo: { name: r.patient_name, email: r.patient_email },
    issuedAt: new Date(r.issued_at).toISOString(),
    payment: r.payment_method ? { method: r.payment_method, ref: r.payment_ref, paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null } : null,
    refund: r.credit_note_no ? { amountPaise: r.refund_paise, creditNoteNo: r.credit_note_no, at: r.refunded_at ? new Date(r.refunded_at).toISOString() : null } : null,
    pdfUrl: `/api/invoices/${r.id}/pdf`,
  }
}
export type InvoiceView = ReturnType<typeof invoiceView>

/* ---------- formatting shared by the PDF ---------- */
export const rupees = (paise: number) => {
  const neg = paise < 0
  const p = Math.abs(Math.round(paise))
  const whole = String(Math.floor(p / 100))
  // Indian digit grouping: 12,34,567
  const last3 = whole.slice(-3)
  const rest = whole.slice(0, -3)
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3
  return `${neg ? '-' : ''}₹${grouped}.${String(p % 100).padStart(2, '0')}`
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`)
const below1000 = (n: number) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + below100(n % 100) : ''}` : below100(n))

/** 72950 paise -> "Seven Hundred Twenty Nine Rupees and Fifty Paise Only" (lakh/crore system). */
export function amountInWords(paise: number): string {
  const p = Math.round(paise)
  let r = Math.floor(p / 100)
  const ps = p % 100
  if (r === 0 && ps === 0) return 'Zero Rupees Only'
  const parts: string[] = []
  const crore = Math.floor(r / 10_000_000)
  r %= 10_000_000
  const lakh = Math.floor(r / 100_000)
  r %= 100_000
  const thousand = Math.floor(r / 1000)
  r %= 1000
  if (crore) parts.push(`${below1000(crore)} Crore`)
  if (lakh) parts.push(`${below100(lakh)} Lakh`)
  if (thousand) parts.push(`${below100(thousand)} Thousand`)
  if (r) parts.push(below1000(r))
  const rupeePart = parts.length ? `${parts.join(' ')} Rupees` : ''
  const paisePart = ps ? `${below100(ps)} Paise` : ''
  return `${[rupeePart, paisePart].filter(Boolean).join(' and ')} Only`
}

export const clinicStamp = (ms: number, offsetMin: number) => {
  const d = new Date(ms + offsetMin * 60_000)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  const { h, m } = clinicHourMinute(ms, offsetMin)
  const h12 = h % 12 || 12
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
