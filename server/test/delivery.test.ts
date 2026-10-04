import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createApp } from '../src/app.js'
import { clinicToUtc } from '../src/time.js'
import type { Mailer, MailOptions } from '../src/services/delivery.js'

const OFFSET = 330
const clock = { t: clinicToUtc('2026-10-05', 8, 0, OFFSET) }
const sent: MailOptions[] = []
const mailer: Mailer = { sendMail: async (o) => void sent.push(o) }
let server: Server
let base = ''
let close: () => void

async function api(method: string, path: string, o: { token?: string; body?: unknown } = {}) {
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
  return { status: res.status, json, buf, type: res.headers.get('content-type') ?? '' }
}
const register = async (email: string) => (await api('POST', '/api/auth/register', { body: { name: 'Test Person', email, password: 'password123' } })).json.token as string
const login = async (email: string) => (await api('POST', '/api/auth/login', { body: { email, password: 'doctor123' } })).json.token as string
const firstSlot = async (doctorId: string, date: string) => {
  const r = await api('GET', `/api/doctors/${doctorId}/slots?date=${date}`)
  return (r.json.slots as { start: string; available: boolean }[]).find((s) => s.available)!.start
}
const bookFor = async (token: string, doctorId: string, date: string) =>
  (await api('POST', '/api/appointments', { token, body: { doctorId, start: await firstSlot(doctorId, date) } })).json
const tick = () => new Promise((r) => setTimeout(r, 50))

before(async () => {
  const a = createApp({
    config: { dbPath: ':memory:', jwtSecret: 'test-secret-test-secret-test-secret', seed: true, clinicOffsetMin: OFFSET, publicUrl: 'https://vitalink.test', shareTtlHours: 1 },
    now: () => clock.t,
    authRateLimit: 1000,
    mailer,
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

describe('share links', () => {
  it('opens the PDF without login, rejects tampering, expires', async () => {
    const t = await register('share@test.dev')
    const appt = await bookFor(t, 'doc_3', '2026-10-06')
    const s = await api('POST', `/api/invoices/${appt.invoice.id}/share`, { token: t, body: {} })
    assert.equal(s.status, 200)
    assert.ok(s.json.url.startsWith('https://vitalink.test/api/public/invoices/'))
    assert.match(s.json.whatsappUrl, /^https:\/\/wa\.me\/\?text=/)

    const path = s.json.url.replace('https://vitalink.test', '')
    const ok = await api('GET', path)
    assert.equal(ok.status, 200)
    assert.equal(ok.type, 'application/pdf')
    assert.equal(ok.buf.subarray(0, 4).toString(), '%PDF')

    assert.equal((await api('GET', path.replace(/sig=.{4}/, 'sig=AAAA'))).status, 404) // tampered signature
    assert.equal((await api('GET', path.replace(/exp=\d+/, 'exp=9999999999999'))).status, 404) // tampered expiry
    clock.t += 2 * 3_600_000
    assert.equal((await api('GET', path)).status, 410) // expired
    clock.t -= 2 * 3_600_000
  })

  it('only the patient can create a link', async () => {
    const owner = await register('own2@test.dev')
    const stranger = await register('str2@test.dev')
    const appt = await bookFor(owner, 'doc_3', '2026-10-07')
    assert.equal((await api('POST', `/api/invoices/${appt.invoice.id}/share`, { body: {} })).status, 401)
    assert.equal((await api('POST', `/api/invoices/${appt.invoice.id}/share`, { token: stranger, body: {} })).status, 403)
    assert.equal((await api('POST', `/api/invoices/${appt.invoice.id}/share`, { token: await login('doctor3@vitalink.test'), body: {} })).status, 403)
  })
})

describe('invoice email', () => {
  it('emails the PDF to the patient on request, with a cooldown', async () => {
    sent.length = 0
    const t = await register('mail@test.dev')
    const appt = await bookFor(t, 'doc_4', '2026-10-06')
    const r = await api('POST', `/api/invoices/${appt.invoice.id}/email`, { token: t, body: {} })
    assert.equal(r.status, 200)
    assert.equal(r.json.status, 'sent')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, 'mail@test.dev')
    assert.equal(sent[0].attachments?.[0].content.subarray(0, 4).toString(), '%PDF')
    assert.equal((await api('POST', `/api/invoices/${appt.invoice.id}/email`, { token: t, body: {} })).status, 429)
    clock.t += 61_000
    assert.equal((await api('POST', `/api/invoices/${appt.invoice.id}/email`, { token: t, body: {} })).status, 200)
  })

  it('sends a receipt automatically after an online payment, but not for pay-at-clinic', async () => {
    sent.length = 0
    const t = await register('auto@test.dev')
    const a1 = await bookFor(t, 'doc_5', '2026-10-06')
    await api('POST', `/api/invoices/${a1.invoice.id}/pay`, { token: t, body: { method: 'upi' } })
    await tick()
    assert.equal(sent.length, 1)
    assert.match(sent[0].subject, /Paid/)

    const a2 = await bookFor(t, 'doc_5', '2026-10-07')
    await api('POST', `/api/invoices/${a2.invoice.id}/pay`, { token: t, body: { method: 'pay_at_clinic' } })
    await tick()
    assert.equal(sent.length, 1)
  })
})

describe('doctor dashboard', () => {
  it('is doctor-only and totals only that doctor’s own money', async () => {
    const t = await register('dash@test.dev')
    const appt = await bookFor(t, 'doc_7', '2026-10-05')
    await api('POST', `/api/invoices/${appt.invoice.id}/pay`, { token: t, body: { method: 'upi' } })

    assert.equal((await api('GET', '/api/doctor/dashboard')).status, 401)
    assert.equal((await api('GET', '/api/doctor/dashboard', { token: t })).status, 403)

    const d = await api('GET', '/api/doctor/dashboard', { token: await login('doctor7@vitalink.test') })
    assert.equal(d.status, 200)
    const consult = appt.invoice.lines[0].amountPaise + appt.invoice.lines[0].taxPaise
    assert.equal(d.json.earnings.paidPaise, consult) // consultation only, never the platform fee
    assert.equal(d.json.earnings.last7Days.length, 7)
    assert.equal(d.json.patients.total, 1)
    assert.equal(d.json.recentBills[0].doctorSharePaise, consult)

    const other = await api('GET', '/api/doctor/dashboard', { token: await login('doctor1@vitalink.test') })
    assert.equal(other.json.earnings.paidPaise, 0)
    assert.equal(other.json.patients.total, 0)
  })
})
