import PDFDocument from 'pdfkit'
import { fileURLToPath } from 'node:url'
import type { BillingConfig } from '../config.js'
import { amountInWords, clinicStamp, rupees, type InvoiceView } from './billing.js'
import { PAYMENTS_MODE } from './payments.js'

const REG = fileURLToPath(new URL('../../assets/fonts/invoice-regular.ttf', import.meta.url))
const BOLD = fileURLToPath(new URL('../../assets/fonts/invoice-bold.ttf', import.meta.url))

const INK = '#0b1f2a'
const MUTED = '#5b6b75'
const RULE = '#d9e0e6'
const ACCENT = '#b9aae3'

export interface PdfContext {
  billing: BillingConfig
  clinicOffsetMin: number
  appointment: { bookingId: string; token: string; start: number; doctorName: string; specialty: string; room: string; reason: string }
}

const METHOD: Record<string, string> = { upi: 'UPI', card: 'Credit / debit card', netbanking: 'Net banking', pay_at_clinic: 'Pay at clinic' }
const STATUS: Record<string, { label: string; color: string }> = {
  paid: { label: 'PAID', color: '#1f9d6b' },
  pending: { label: 'PAYMENT PENDING', color: '#c77d0a' },
  refunded: { label: 'REFUNDED', color: '#3a6ea5' },
  void: { label: 'CANCELLED', color: '#c0392b' },
}

export function buildInvoicePdf(inv: InvoiceView, ctx: PdfContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${inv.invoiceNo}`, Author: ctx.billing.sellerName } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.registerFont('R', REG)
    doc.registerFont('B', BOLD)

    const L = 48
    const W = doc.page.width - 96 // 499
    const R = L + W
    const stamp = (ms: number) => clinicStamp(ms, ctx.clinicOffsetMin)
    const label = (t: string, x: number, y: number) => doc.font('B').fontSize(7.5).fillColor(MUTED).text(t.toUpperCase(), x, y, { characterSpacing: 0.8, lineBreak: false })
    const value = (t: string, x: number, y: number, w: number, o: { bold?: boolean; size?: number; color?: string } = {}) =>
      doc.font(o.bold ? 'B' : 'R').fontSize(o.size ?? 9.5).fillColor(o.color ?? INK).text(t, x, y, { width: w })

    /* ---- header ---- */
    doc.roundedRect(L, 44, 30, 30, 9).fill(ACCENT)
    doc.lineWidth(2.2).lineCap('round').lineJoin('round').strokeColor(INK)
    doc.moveTo(L + 4, 60).lineTo(L + 10, 60).lineTo(L + 13, 53).lineTo(L + 18, 66).lineTo(L + 21, 60).lineTo(L + 26, 60).stroke()
    doc.font('B').fontSize(19).fillColor(INK).text('VITALINK', L + 40, 47, { lineBreak: false })
    doc.font('R').fontSize(8.5).fillColor(MUTED).text('Healthcare, without the wait', L + 40, 68, { lineBreak: false })

    doc.font('B').fontSize(22).fillColor(INK).text('INVOICE', L, 44, { width: W, align: 'right', lineBreak: false })
    const st = STATUS[inv.status] ?? STATUS.pending
    const chipW = doc.font('B').fontSize(8.5).widthOfString(st.label) + 22
    doc.roundedRect(R - chipW, 72, chipW, 20, 10).fill(st.color)
    doc.font('B').fontSize(8.5).fillColor('#ffffff').text(st.label, R - chipW, 78, { width: chipW, align: 'center', lineBreak: false })

    doc.moveTo(L, 104).lineTo(R, 104).lineWidth(0.8).strokeColor(RULE).stroke()

    /* ---- seller + invoice meta ---- */
    let y = 118
    label('Sold by', L, y)
    value(ctx.billing.sellerName, L, y + 12, 230, { bold: true })
    value(ctx.billing.sellerAddress, L, y + 26, 230, { color: MUTED, size: 9 })
    if (ctx.billing.sellerGstin) value(`GSTIN: ${ctx.billing.sellerGstin}`, L, y + 52, 230, { color: MUTED, size: 9 })

    const mx = 330
    label('Invoice no.', mx, y)
    value(inv.invoiceNo, mx, y + 12, 170, { bold: true })
    label('Invoice date', mx + 105, y)
    value(stamp(Date.parse(inv.issuedAt)).split(',')[0], mx + 105, y + 12, 95)
    label('Booking ID', mx, y + 38)
    value(ctx.appointment.bookingId, mx, y + 50, 100, { bold: true })
    label('Token', mx + 105, y + 38)
    value(ctx.appointment.token, mx + 105, y + 50, 95, { bold: true })

    /* ---- billed to / appointment ---- */
    y = 206
    doc.roundedRect(L, y, 242, 92, 10).lineWidth(0.8).strokeColor(RULE).stroke()
    doc.roundedRect(L + 257, y, 242, 92, 10).lineWidth(0.8).strokeColor(RULE).stroke()
    label('Billed to', L + 14, y + 12)
    value(inv.billedTo.name, L + 14, y + 26, 214, { bold: true, size: 11 })
    value(inv.billedTo.email, L + 14, y + 44, 214, { color: MUTED, size: 9 })
    label('Appointment', L + 271, y + 12)
    value(`${ctx.appointment.doctorName}`, L + 271, y + 26, 214, { bold: true, size: 11 })
    value(`${ctx.appointment.specialty} · ${ctx.appointment.room}`, L + 271, y + 44, 214, { color: MUTED, size: 9 })
    value(stamp(ctx.appointment.start), L + 271, y + 60, 214, { size: 9 })

    /* ---- line items ---- */
    y = 322
    const col = { desc: L + 12, qty: L + 232, rate: L + 262, gst: L + 332, amt: L + 412 }
    doc.rect(L, y, W, 24).fill('#eef1f8')
    const th = (t: string, x: number, w: number, a: 'left' | 'right' = 'left') => doc.font('B').fontSize(8).fillColor(MUTED).text(t.toUpperCase(), x, y + 8, { width: w, align: a, characterSpacing: 0.6, lineBreak: false })
    th('Description', col.desc, 210)
    th('Qty', col.qty, 24, 'right')
    th('Rate', col.rate, 62, 'right')
    th('GST', col.gst, 72, 'right')
    th('Amount', col.amt, 75, 'right')
    y += 24
    for (const l of inv.lines) {
      const hh = doc.font('R').fontSize(9.5).heightOfString(l.description, { width: 212 })
      const rowH = Math.max(30, hh + 16)
      value(l.description, col.desc, y + 8, 212)
      doc.font('R').fontSize(9.5).fillColor(INK)
      doc.text(String(l.qty), col.qty, y + 8, { width: 24, align: 'right', lineBreak: false })
      doc.text(rupees(l.unitPaise), col.rate, y + 8, { width: 62, align: 'right', lineBreak: false })
      doc.text(`${l.taxPct}% · ${rupees(l.taxPaise)}`, col.gst, y + 8, { width: 72, align: 'right', lineBreak: false })
      doc.font('B').text(rupees(l.amountPaise + l.taxPaise), col.amt, y + 8, { width: 75, align: 'right', lineBreak: false })
      y += rowH
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(RULE).stroke()
    }

    /* ---- totals ---- */
    y += 14
    const tl = L + 290
    const row = (k: string, v: string, bold = false) => {
      doc.font(bold ? 'B' : 'R').fontSize(bold ? 12 : 9.5).fillColor(INK)
      doc.text(k, tl, y, { width: 110, lineBreak: false })
      doc.text(v, tl + 110, y, { width: 99, align: 'right', lineBreak: false })
      y += bold ? 22 : 17
    }
    row('Subtotal', rupees(inv.subtotalPaise))
    row('GST', rupees(inv.taxPaise))
    doc.moveTo(tl, y - 2).lineTo(R, y - 2).lineWidth(0.8).strokeColor(INK).stroke()
    y += 6
    row('Total', rupees(inv.totalPaise), true)
    if (inv.refund) row('Refunded', `-${rupees(inv.refund.amountPaise)}`)

    label('Amount in words', L, y - 56)
    value(amountInWords(inv.totalPaise), L, y - 44, 270, { size: 9 })

    /* ---- payment ---- */
    y += 16
    doc.roundedRect(L, y, W, inv.refund ? 98 : 62, 10).fill('#f6f7fb')
    label('Payment', L + 14, y + 12)
    if (inv.payment && inv.payment.paidAt) {
      value(`${METHOD[inv.payment.method] ?? inv.payment.method}  ·  Ref ${inv.payment.ref ?? '-'}`, L + 14, y + 26, 330, { bold: true })
      value(`Paid on ${stamp(Date.parse(inv.payment.paidAt))}`, L + 14, y + 42, 330, { color: MUTED, size: 9 })
    } else if (inv.payment?.method === 'pay_at_clinic') {
      value('Pay at clinic. Due at your visit.', L + 14, y + 26, 440, { bold: true })
      value('This invoice is marked paid once the clinic receives payment.', L + 14, y + 42, 440, { color: MUTED, size: 9 })
    } else if (inv.status === 'void') {
      value('Appointment cancelled before payment. Nothing is due.', L + 14, y + 26, 440, { bold: true })
    } else {
      value('Awaiting payment.', L + 14, y + 26, 440, { bold: true })
      value('Pay online from your appointment, or choose pay at clinic.', L + 14, y + 42, 440, { color: MUTED, size: 9 })
    }
    if (inv.refund) {
      doc.moveTo(L + 14, y + 62).lineTo(R - 14, y + 62).lineWidth(0.6).strokeColor(RULE).stroke()
      label('Credit note', L + 14, y + 70)
      value(`${inv.refund.creditNoteNo}  ·  ${rupees(inv.refund.amountPaise)} refunded${inv.refund.at ? ' on ' + stamp(Date.parse(inv.refund.at)) : ''}`, L + 14, y + 82, 440, { bold: true, size: 9 })
    }

    /* ---- footer ---- */
    // pdfkit starts a new page if text lands inside the bottom margin; the footer lives there on purpose
    doc.page.margins.bottom = 0
    const fy = doc.page.height - 78
    doc.moveTo(L, fy).lineTo(R, fy).lineWidth(0.8).strokeColor(RULE).stroke()
    doc.font('R').fontSize(8).fillColor(MUTED)
    doc.text('This is a computer-generated invoice and does not require a signature.', L, fy + 10, { width: W, align: 'center', lineBreak: false })
    if (PAYMENTS_MODE === 'demo') {
      doc.text('Demo build: payments are simulated and no real money was charged.', L, fy + 24, { width: W, align: 'center', lineBreak: false })
    }
    doc.text(`${ctx.billing.sellerName}  ·  ${inv.invoiceNo}`, L, fy + 38, { width: W, align: 'center', lineBreak: false })

    doc.end()
  })
}
