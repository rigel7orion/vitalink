import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createApp } from '../src/app.js'
import { clinicToUtc } from '../src/time.js'
import { amountInWords, computeBill, fiscalTag, rupees } from '../src/services/billing.js'

const OFFSET = 330
const clock = { t: clinicToUtc('2026-10-05', 8, 0, OFFSET) } // Mon 5 Oct 2026, 08:00 clinic time
let server: Server
let base = ''
let close: () => void

type Opts = { token?: string; body?: unknown }
async function api(method: string, path: string, o: Opts = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  })
  const buf = Buffer.from(await res.arrayBuffer())
  let json: any = null
  try {
    json = JSON.parse(buf.toString())
  } catch {
    /* binary */
  }
  return { status: res.status, json, buf, type: res.headers.get('content-type') ?? '', disp: res.headers.get('content-disposition') ?? '' }
}
const register = async (email: string) => {
  const r = await api('POST', '/api/auth/register', { body: { name: 'Test Person', email, password: 'password123' } })
  assert.equal(r.status, 201, JSON.stringify(r.json))
  return r.json.token as string
}
const login = async (email: string, password: string) => (await api('POST', '/api/auth/login', { body: { email, password } })).json.token as string
const slots = async (doctorId: string, date: string) => {
  const r = await api('GET', `/api/doctors/${doctorId}/slots?date=${date}`)
  return (r.json.slots as { start: string; available: boolean }[]).filter((s) => s.available).map((s) => s.start)
}
const book = (token: string, doctorId: string, start: string) => api('POST', '/api/appointments', { token, body: { doctorId, start } })

before(async () => {
  const a = createApp({
    config: { dbPath: ':memory:', jwtSecret: 'test-secret-test-secret-test-secret', seed: true, clinicOffsetMin: OFFSET },
    now: () => clock.t,
    authRateLimit: 1000,
  })
  close = a.close
  server = a.app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => {
  server.closeAllConnections()
  server.close()
  close()
})

describe('billing math', () => {
  it('computes consultation + platform fee with GST in paise', () => {
    const b = computeBill(700, 'Dr. X', 'Dermatology', { platformFeePaise: 2500, platformGstPct: 18, consultGstPct: 0, sellerName: 's', sellerAddress: 'a' })
    assert.equal(b.subtotalPaise, 72_500)
    assert.equal(b.taxPaise, 450)
    assert.equal(b.totalPaise, 72_950)
    assert.equal(b.lines.length, 2)
  })
  it('rounds tax half-up per line and supports a taxed consultation', () => {
    const b = computeBill(501, 'Dr. X', 'GP', { platformFeePaise: 1999, platformGstPct: 18, consultGstPct: 5, sellerName: 's', sellerAddress: 'a' })
    assert.equal(b.lines[0].taxPaise, Math.round(50_100 * 0.05)) // 2505
    assert.equal(b.lines[1].taxPaise, 360) // 359.82 -> 360
    assert.equal(b.totalPaise, b.subtotalPaise + b.taxPaise)
  })
  it('formats rupees with Indian grouping and amounts in words', () => {
    assert.equal(rupees(72_950), '₹729.50')
    assert.equal(rupees(123_456_789), '₹12,34,567.89')
    assert.equal(amountInWords(72_950), 'Seven Hundred Twenty Nine Rupees and Fifty Paise Only')
    assert.equal(amountInWords(1_00_000_00), 'One Lakh Rupees Only')
    assert.equal(amountInWords(0), 'Zero Rupees Only')
  })
  it('uses the Indian financial year (April to March)', () => {
    assert.equal(fiscalTag(clinicToUtc('2026-10-05', 9, 0, OFFSET), OFFSET), '2627')
    assert.equal(fiscalTag(clinicToUtc('2027-03-31', 23, 0, OFFSET), OFFSET), '2627')
    assert.equal(fiscalTag(clinicToUtc('2027-04-01', 1, 0, OFFSET), OFFSET), '2728')
  })
})

describe('invoice lifecycle', () => {
  it('booking creates a pending invoice with the right totals and number format', async () => {
    const t = await register('bill1@test.dev')
    const [s1] = await slots('doc_1', '2026-10-06')
    const r = await book(t, 'doc_1', s1)
    assert.equal(r.status, 201, JSON.stringify(r.json))
    const inv = r.json.invoice
    assert.match(inv.invoiceNo, /^VL\/2627\/\d{6}$/)
    assert.equal(inv.status, 'pending')
    assert.equal(inv.totalPaise, 72_950) // doc_1 fee is Rs 700
    assert.equal(inv.currency, 'INR')
    const again = await api('GET', `/api/appointments/${r.json.id}/invoice`, { token: t })
    assert.equal(again.json.id, inv.id)
  })

  it('numbers are sequential and a failed booking leaves no gap', async () => {
    const a = await register('bill2a@test.dev')
    const b = await register('bill2b@test.dev')
    const free = await slots('doc_2', '2026-10-06')
    const one = await book(a, 'doc_2', free[0])
    // b tries the SAME slot: must fail, and must not burn an invoice number
    const clash = await book(b, 'doc_2', free[0])
    assert.equal(clash.status, 409)
    const two = await book(b, 'doc_2', free[1])
    const n = (x: string) => Number(x.split('/')[2])
    assert.equal(n(two.json.invoice.invoiceNo), n(one.json.invoice.invoiceNo) + 1)
  })

  it('pays once; second payment and extra (card) fields are rejected', async () => {
    const t = await register('bill3@test.dev')
    const [s] = await slots('doc_3', '2026-10-06')
    const { json: appt } = await book(t, 'doc_3', s)
    const id = appt.invoice.id

    const sneaky = await api('POST', `/api/invoices/${id}/pay`, { token: t, body: { method: 'card', cardNumber: '4111111111111111' } })
    assert.equal(sneaky.status, 400) // card data is never accepted

    const ok = await api('POST', `/api/invoices/${id}/pay`, { token: t, body: { method: 'upi' } })
    assert.equal(ok.status, 200)
    assert.equal(ok.json.status, 'paid')
    assert.match(ok.json.payment.ref, /^PAY-[0-9A-F]{10}$/)

    const dup = await api('POST', `/api/invoices/${id}/pay`, { token: t, body: { method: 'upi' } })
    assert.equal(dup.status, 409)
    assert.equal(dup.json.code, 'already_paid')
  })

  it('cancelling a PAID booking refunds in full with a credit note', async () => {
    const t = await register('bill4@test.dev')
    const [s] = await slots('doc_4', '2026-10-06')
    const { json: appt } = await book(t, 'doc_4', s)
    await api('POST', `/api/invoices/${appt.invoice.id}/pay`, { token: t, body: { method: 'card' } })
    const c = await api('DELETE', `/api/appointments/${appt.id}`, { token: t })
    assert.equal(c.status, 200)
    assert.equal(c.json.invoice.status, 'refunded')
    assert.equal(c.json.invoice.refund.amountPaise, appt.invoice.totalPaise)
    assert.match(c.json.invoice.refund.creditNoteNo, /^CN\/2627\/\d{6}$/)
    const repay = await api('POST', `/api/invoices/${appt.invoice.id}/pay`, { token: t, body: { method: 'upi' } })
    assert.equal(repay.status, 409)
  })

  it('cancelling an UNPAID booking voids the invoice', async () => {
    const t = await register('bill5@test.dev')
    const [s] = await slots('doc_5', '2026-10-06')
    const { json: appt } = await book(t, 'doc_5', s)
    const c = await api('DELETE', `/api/appointments/${appt.id}`, { token: t })
    assert.equal(c.json.invoice.status, 'void')
    assert.equal(c.json.invoice.refund, null)
  })

  it('pay-at-clinic stays pending until the doctor completes the visit', async () => {
    const t = await register('bill6@test.dev')
    const [s] = await slots('doc_2', '2026-10-07')
    const { json: appt } = await book(t, 'doc_2', s)
    const p = await api('POST', `/api/invoices/${appt.invoice.id}/pay`, { token: t, body: { method: 'pay_at_clinic' } })
    assert.equal(p.json.status, 'pending')
    assert.equal(p.json.payment.method, 'pay_at_clinic')
    const doc = await login('doctor2@vitalink.test', 'doctor123')
    const done = await api('POST', `/api/appointments/${appt.id}/complete`, { token: doc })
    assert.equal(done.status, 200)
    const after = await api('GET', `/api/invoices/${appt.invoice.id}`, { token: t })
    assert.equal(after.json.status, 'paid')
    assert.match(after.json.payment.ref, /^CASH-/)
  })
})

describe('invoice access', () => {
  it('only the patient and the treating doctor can see an invoice', async () => {
    const owner = await register('own@test.dev')
    const stranger = await register('stranger@test.dev')
    const [s] = await slots('doc_6', '2026-10-06')
    const { json: appt } = await book(owner, 'doc_6', s)
    const id = appt.invoice.id

    assert.equal((await api('GET', `/api/invoices/${id}`)).status, 401)
    assert.equal((await api('GET', `/api/invoices/${id}`, { token: stranger })).status, 403)
    assert.equal((await api('GET', `/api/invoices/${id}/pdf`, { token: stranger })).status, 403)
    assert.equal((await api('POST', `/api/invoices/${id}/pay`, { token: stranger, body: { method: 'upi' } })).status, 403)

    const treating = await login('doctor6@vitalink.test', 'doctor123')
    const other = await login('doctor1@vitalink.test', 'doctor123')
    assert.equal((await api('GET', `/api/invoices/${id}`, { token: treating })).status, 200)
    assert.equal((await api('GET', `/api/invoices/${id}`, { token: other })).status, 403)
    // a doctor cannot pay on the patient's behalf
    assert.equal((await api('POST', `/api/invoices/${id}/pay`, { token: treating, body: { method: 'upi' } })).status, 403)

    const list = await api('GET', '/api/invoices', { token: owner })
    assert.equal(list.json.length, 1)
    assert.equal((await api('GET', '/api/invoices', { token: stranger })).json.length, 0)
  })
})

describe('invoice pdf', () => {
  it('returns a real PDF with a sensible filename', async () => {
    const t = await register('pdf@test.dev')
    const [s] = await slots('doc_7', '2026-10-06')
    const { json: appt } = await book(t, 'doc_7', s)
    await api('POST', `/api/invoices/${appt.invoice.id}/pay`, { token: t, body: { method: 'upi' } })
    const r = await api('GET', `/api/invoices/${appt.invoice.id}/pdf`, { token: t })
    assert.equal(r.status, 200)
    assert.equal(r.type, 'application/pdf')
    assert.equal(r.buf.subarray(0, 5).toString(), '%PDF-')
    assert.ok(r.buf.length > 3000)
    assert.match(r.disp, /VITALINK-VL-2627-\d{6}\.pdf/)
  })
})
