import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth.js'
import { DEMO } from '../src/db.js'
import { clinicToUtc } from '../src/time.js'

const OFFSET = 330
// Monday 5 Oct 2026, 08:00 clinic time. "Tomorrow" is Tuesday 6 Oct.
const clock = { t: clinicToUtc('2026-10-05', 8, 0, OFFSET) }
const SECRET = 'test-secret-test-secret-test-secret'

let server: Server
let base = ''
let close: () => void

type Opts = { token?: string; body?: unknown; headers?: Record<string, string> }
async function api(method: string, path: string, o: Opts = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      ...o.headers,
    },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* not json */
  }
  return { status: res.status, json }
}

const register = async (email: string, extra: Record<string, unknown> = {}) => {
  const r = await api('POST', '/api/auth/register', { body: { name: 'Test Person', email, password: 'password123', ...extra } })
  assert.equal(r.status, 201, JSON.stringify(r.json))
  return r.json as { token: string; user: { id: string } }
}
const login = async (email: string, password: string) => {
  const r = await api('POST', '/api/auth/login', { body: { email, password } })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  return r.json.token as string
}
const firstFreeSlot = async (doctorId: string, date: string, hourFrom = 0) => {
  const r = await api('GET', `/api/doctors/${doctorId}/slots?date=${date}`)
  const s = (r.json.slots as { start: string; available: boolean }[]).filter((x) => x.available && new Date(x.start).getTime() >= clinicToUtc(date, hourFrom, 0, OFFSET))
  assert.ok(s.length, 'expected a free slot')
  return s[0].start
}

before(async () => {
  const a = createApp({
    config: { dbPath: ':memory:', jwtSecret: SECRET, seed: true, clinicOffsetMin: OFFSET },
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

describe('auth', () => {
  it('health works', async () => {
    const r = await api('GET', '/api/health')
    assert.equal(r.status, 200)
    assert.equal(r.json.doctors, 8)
  })
  it('registers, rejects duplicates and weak passwords, logs in', async () => {
    await register('a@x.test')
    const dup = await api('POST', '/api/auth/register', { body: { name: 'Dup', email: 'A@X.test', password: 'password123' } })
    assert.equal(dup.status, 409)
    assert.equal(dup.json.code, 'email_taken')
    const weak = await api('POST', '/api/auth/register', { body: { name: 'Weak', email: 'w@x.test', password: 'short' } })
    assert.equal(weak.status, 400)
    assert.equal(weak.json.code, 'validation')
    await login('a@x.test', 'password123')
    const bad = await api('POST', '/api/auth/login', { body: { email: 'a@x.test', password: 'nope-nope' } })
    assert.equal(bad.status, 401)
    const unknown = await api('POST', '/api/auth/login', { body: { email: 'nobody@x.test', password: 'nope-nope' } })
    assert.equal(unknown.json.error, bad.json.error, 'same message for unknown email and wrong password')
  })
  it('rejects tampered and expired tokens', async () => {
    const { token, user } = await register('t@x.test')
    assert.equal((await api('GET', '/api/me', { token })).status, 200)
    assert.equal((await api('GET', '/api/me', { token: token.slice(0, -2) + 'xx' })).status, 401)
    const expired = signToken({ id: user.id, role: 'patient' }, SECRET, -10)
    assert.equal((await api('GET', '/api/me', { token: expired })).status, 401)
    assert.equal((await api('GET', '/api/me')).status, 401)
  })
})

describe('doctors, slots, queue', () => {
  it('lists doctors and specialties, filters by specialty', async () => {
    const all = await api('GET', '/api/doctors')
    assert.equal(all.json.length, 8)
    const derm = await api('GET', '/api/doctors?specialty=dermatology')
    assert.equal(derm.json.length, 2)
    const sp = await api('GET', '/api/specialties')
    assert.ok(sp.json.includes('Pediatrics'))
  })
  it('generates slots, hides the past, is closed on Sundays', async () => {
    const mon = await api('GET', '/api/doctors/doc_2/slots?date=2026-10-05') // GP 9-17, now 08:00
    assert.equal(mon.json.slots.length, 16)
    clock.t = clinicToUtc('2026-10-05', 12, 0, OFFSET)
    const later = await api('GET', '/api/doctors/doc_2/slots?date=2026-10-05')
    assert.ok(later.json.slots.length < 16, 'past slots are gone')
    clock.t = clinicToUtc('2026-10-05', 8, 0, OFFSET)
    const sun = await api('GET', '/api/doctors/doc_2/slots?date=2026-10-11')
    assert.equal(sun.json.slots.length, 0)
    assert.equal((await api('GET', '/api/doctors/doc_2/slots?date=nope')).status, 400)
    assert.equal((await api('GET', '/api/doctors/nope/slots')).status, 404)
  })
  it('reports the queue', async () => {
    const q = await api('GET', '/api/doctors/doc_2/queue')
    assert.equal(q.status, 200)
    assert.equal(q.json.remainingToday, 0)
    assert.ok(q.json.nextFreeSlot)
  })
})

describe('CITYCARE AI intent booking', () => {
  it('turns the deck example into structured intent plus real options', async () => {
    const r = await api('POST', '/api/intent/parse', {
      body: { text: 'I need a dermatologist tomorrow evening, preferably near me, and I do not want to wait too long.', lat: 22.5726, lng: 88.3639 },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.parsed.specialty, 'Dermatology')
    assert.equal(r.json.parsed.date, '2026-10-06')
    assert.equal(r.json.parsed.timePreference.label, 'Evening')
    assert.equal(r.json.parsed.location, 'nearby')
    assert.equal(r.json.parsed.priority, 'low_waiting_time')
    assert.equal(r.json.requiresConfirmation, true)
    assert.ok(r.json.options.length > 0)
    for (const o of r.json.options) {
      assert.equal(o.doctor.specialty, 'Dermatology')
      const hour = new Date(new Date(o.start).getTime() + OFFSET * 60_000).getUTCHours()
      assert.ok(hour >= 16 && hour < 21, `slot hour ${hour} should be evening`)
      assert.ok(o.start.startsWith('2026-10-06') || o.start.startsWith('2026-10-05'))
    }
    // nothing was booked
    const mine = await register('intent@x.test')
    assert.equal((await api('GET', '/api/appointments', { token: mine.token })).json.length, 0)
  })
  it('reports what is missing and handles other phrasings', async () => {
    const r = await api('POST', '/api/intent/parse', { body: { text: 'my baby has a rash, any slot next monday morning' } })
    assert.equal(r.json.parsed.specialty, 'Pediatrics')
    assert.equal(r.json.parsed.date, '2026-10-12')
    assert.equal(r.json.parsed.timePreference.label, 'Morning')
    const none = await api('POST', '/api/intent/parse', { body: { text: 'hello there' } })
    assert.ok(none.json.missing.includes('specialty'))
    assert.deepEqual(none.json.options, [])
    assert.equal((await api('POST', '/api/intent/parse', { body: { text: 'x' } })).status, 400)
  })
})

describe('appointments', () => {
  it('books, blocks double-booking, enforces roles, cancels, frees the slot', async () => {
    const p1 = await register('p1@x.test')
    const p2 = await register('p2@x.test')
    const start = await firstFreeSlot('doc_2', '2026-10-06', 10)

    const unauth = await api('POST', '/api/appointments', { body: { doctorId: 'doc_2', start } })
    assert.equal(unauth.status, 401)
    const docToken = await login('doctor2@vitalink.test', DEMO.doctorPassword)
    assert.equal((await api('POST', '/api/appointments', { token: docToken, body: { doctorId: 'doc_2', start } })).status, 403)

    const ok = await api('POST', '/api/appointments', { token: p1.token, body: { doctorId: 'doc_2', start, reason: 'Fever' } })
    assert.equal(ok.status, 201, JSON.stringify(ok.json))
    assert.match(ok.json.bookingId, /^BK-G-[0-9A-F]{6}$/)
    assert.match(ok.json.token, /^G-\d+$/)
    assert.equal(ok.json.status, 'booked')

    const taken = await api('POST', '/api/appointments', { token: p2.token, body: { doctorId: 'doc_2', start } })
    assert.equal(taken.status, 409)
    assert.equal(taken.json.code, 'slot_taken')

    const other = await firstFreeSlot('doc_8', '2026-10-06', 0)
    const sameTimeStart = start // p1 is already booked at this time with another doctor
    const busy = await api('POST', '/api/appointments', { token: p1.token, body: { doctorId: 'doc_8', start: sameTimeStart } })
    assert.ok([409, 400].includes(busy.status))
    if (busy.status === 409) assert.equal(busy.json.code, 'patient_busy')
    assert.ok(other)

    const bad = await api('POST', '/api/appointments', { token: p1.token, body: { doctorId: 'doc_2', start: '2026-10-06T10:07:00.000Z' } })
    assert.equal(bad.status, 400)
    assert.equal(bad.json.code, 'invalid_slot')

    // other patients cannot see or cancel it
    assert.equal((await api('GET', `/api/appointments/${ok.json.id}`, { token: p2.token })).status, 403)
    assert.equal((await api('DELETE', `/api/appointments/${ok.json.id}`, { token: p2.token })).status, 403)

    const cancelled = await api('DELETE', `/api/appointments/${ok.json.id}`, { token: p1.token })
    assert.equal(cancelled.json.status, 'cancelled')
    assert.equal((await api('DELETE', `/api/appointments/${ok.json.id}`, { token: p1.token })).status, 409)

    // the slot is free again and someone else can take it
    const again = await api('POST', '/api/appointments', { token: p2.token, body: { doctorId: 'doc_2', start } })
    assert.equal(again.status, 201)
  })

  it('only one of many simultaneous requests wins a slot', async () => {
    const users = await Promise.all(Array.from({ length: 6 }, (_, i) => register(`race${i}@x.test`)))
    const start = await firstFreeSlot('doc_3', '2026-10-07', 0)
    const results = await Promise.all(users.map((u) => api('POST', '/api/appointments', { token: u.token, body: { doctorId: 'doc_3', start } })))
    const won = results.filter((r) => r.status === 201).length
    const lost = results.filter((r) => r.status === 409).length
    assert.equal(won, 1)
    assert.equal(lost, 5)
  })
})

describe('AI symptom pre-check', () => {
  it('flags emergencies and gives no booking specialty', async () => {
    const r = await api('POST', '/api/triage', { body: { text: 'I have crushing chest pain and trouble breathing' } })
    assert.equal(r.json.urgency, 'emergency')
    assert.equal(r.json.suggestedSpecialty, null)
    assert.match(r.json.advice, /emergency/i)
  })
  it('fever + redness + itching is urgent and goes to dermatology (deck example)', async () => {
    const r = await api('POST', '/api/triage', { body: { symptoms: ['fever', 'redness', 'itching'] } })
    assert.equal(r.json.urgency, 'urgent')
    assert.equal(r.json.suggestedSpecialty, 'Dermatology')
  })
  it('routine, infant and validation cases', async () => {
    const routine = await api('POST', '/api/triage', { body: { text: 'mild cough since two days' } })
    assert.equal(routine.json.urgency, 'routine')
    assert.equal(routine.json.suggestedSpecialty, 'General Medicine')
    const infant = await api('POST', '/api/triage', { body: { text: 'she has a fever', ageGroup: 'infant' } })
    assert.equal(infant.json.urgency, 'urgent')
    assert.equal((await api('POST', '/api/triage', { body: {} })).status, 400)
    assert.ok(routine.json.disclaimer)
  })
})

describe('VitalBand: vitals, anomaly detection, alerts', () => {
  let patient: { token: string; user: { id: string } }
  let key = ''

  it('registers a band and family contacts', async () => {
    patient = await register('band@x.test', { ageGroup: 'senior', lat: 22.5, lng: 88.32 })
    const d = await api('POST', '/api/devices', { token: patient.token, body: { label: 'Grandpa band' } })
    assert.equal(d.status, 201)
    key = d.json.key
    const f = await api('POST', '/api/family', { token: patient.token, body: { name: 'Riya', phone: '+91 98765 43210', relation: 'daughter' } })
    assert.equal(f.status, 201)
    assert.equal((await api('POST', '/api/family', { token: patient.token, body: { name: 'Bad', phone: 'abc' } })).status, 400)
  })

  it('rejects bad or missing device keys', async () => {
    assert.equal((await api('POST', '/api/vitals', { body: { hr: 72, tempC: 36.6 } })).status, 401)
    assert.equal((await api('POST', '/api/vitals', { headers: { 'x-device-key': key.slice(0, -3) + 'abc' }, body: { hr: 72, tempC: 36.6 } })).status, 401)
    assert.equal((await api('POST', '/api/vitals', { headers: { 'x-device-key': key }, body: { hr: 5, tempC: 36.6 } })).status, 400)
  })

  it('normal readings raise no alert', async () => {
    for (const hr of [72, 74, 71]) {
      const r = await api('POST', '/api/vitals', { headers: { 'x-device-key': key }, body: { hr, tempC: 36.6 } })
      assert.equal(r.status, 201)
      assert.equal(r.json.anomalous, false)
    }
  })

  let alertId = ''
  let doctorToken = ''
  it('an abnormal reading alerts the nearest geriatrics doctor and the family', async () => {
    const r = await api('POST', '/api/vitals', { headers: { 'x-device-key': key }, body: { hr: 150, tempC: 39.2 } })
    assert.equal(r.status, 201)
    assert.equal(r.json.anomalous, true)
    const kinds = r.json.alerts.map((a: any) => a.kind).sort()
    assert.deepEqual(kinds, ['fever', 'tachycardia'])
    const a = r.json.alerts[0]
    assert.equal(a.doctor.name, 'Dr. Meera Iyer') // seniors go to geriatrics
    const types = a.notified.map((n: any) => n.type).sort()
    assert.deepEqual(types, ['doctor', 'family'])
    assert.equal(a.severity === 'critical' || a.severity === 'warning', true)
    alertId = a.id
    doctorToken = await login('doctor5@vitalink.test', DEMO.doctorPassword)
  })

  it('does not spam: same anomaly within 5 minutes creates no new alert', async () => {
    const r = await api('POST', '/api/vitals', { headers: { 'x-device-key': key }, body: { hr: 152, tempC: 39.3 } })
    assert.equal(r.json.anomalous, true)
    assert.equal(r.json.alerts.length, 0)
  })

  it('a fall is critical', async () => {
    const r = await api('POST', '/api/vitals', { headers: { 'x-device-key': key }, body: { hr: 80, tempC: 36.5, fall: true } })
    assert.equal(r.json.alerts[0].kind, 'fall')
    assert.equal(r.json.alerts[0].severity, 'critical')
  })

  it('only the assigned doctor can acknowledge', async () => {
    const other = await login('doctor1@vitalink.test', DEMO.doctorPassword)
    assert.equal((await api('PATCH', `/api/alerts/${alertId}/ack`, { token: other })).status, 403)
    assert.equal((await api('PATCH', `/api/alerts/${alertId}/ack`, { token: patient.token })).status, 403)
    const ok = await api('PATCH', `/api/alerts/${alertId}/ack`, { token: doctorToken })
    assert.equal(ok.json.status, 'acknowledged')
    const mine = await api('GET', '/api/alerts?status=open', { token: doctorToken })
    assert.ok(mine.json.every((a: any) => a.status === 'open'))
    const own = await api('GET', '/api/alerts', { token: patient.token })
    assert.ok(own.json.length >= 3)
  })

  it('lists stored vitals', async () => {
    const v = await api('GET', '/api/vitals?limit=3', { token: patient.token })
    assert.equal(v.json.length, 3)
  })

  it('streams alerts live over SSE to the patient', async () => {
    const p = await register('sse@x.test', { ageGroup: 'adult' })
    const d = await api('POST', '/api/devices', { token: p.token, body: { label: 'band' } })
    const ctrl = new AbortController()
    const res = await fetch(`${base}/api/stream?token=${p.token}`, { signal: ctrl.signal })
    assert.equal(res.status, 200)
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    const waitFor = async (needle: string) => {
      while (!buf.includes(needle)) {
        const { value, done } = await reader.read()
        if (done) throw new Error('stream ended')
        buf += dec.decode(value)
      }
    }
    await waitFor('event: ready')
    await api('POST', '/api/vitals', { headers: { 'x-device-key': d.json.key }, body: { hr: 190, tempC: 36.6 } })
    await waitFor('event: alert')
    assert.match(buf, /tachycardia/)
    ctrl.abort()
    assert.equal((await fetch(`${base}/api/stream`)).status, 401)
  })
})

describe('prescriptions, history, medicine delivery', () => {
  let patient: { token: string; user: { id: string } }
  let doc: string
  let apptId = ''
  let rxId = ''

  it('doctor prescribes for their own appointment only', async () => {
    patient = await register('rx@x.test')
    doc = await login('doctor1@vitalink.test', DEMO.doctorPassword) // doc_1, dermatology
    const start = await firstFreeSlot('doc_1', '2026-10-08', 11)
    const a = await api('POST', '/api/appointments', { token: patient.token, body: { doctorId: 'doc_1', start, reason: 'Rash' } })
    apptId = a.json.id

    const body = { appointmentId: apptId, items: [{ name: 'Cetirizine 10mg', dose: '1 tablet', frequency: 'once daily', days: 5 }], notes: 'Avoid scratching' }
    const stranger = await login('doctor3@vitalink.test', DEMO.doctorPassword)
    assert.equal((await api('POST', '/api/prescriptions', { token: stranger, body })).status, 403)
    assert.equal((await api('POST', '/api/prescriptions', { token: patient.token, body })).status, 403)
    assert.equal((await api('POST', '/api/prescriptions', { token: doc, body: { ...body, items: [] } })).status, 400)
    const ok = await api('POST', '/api/prescriptions', { token: doc, body })
    assert.equal(ok.status, 201)
    rxId = ok.json.id
    const mine = await api('GET', '/api/prescriptions', { token: patient.token })
    assert.equal(mine.json.length, 1)
    assert.equal((await api('GET', `/api/prescriptions/${rxId}`, { token: stranger })).status, 403)
  })

  it('doctors see history only for patients they treat', async () => {
    const h = await api('GET', `/api/patients/${patient.user.id}/history`, { token: doc })
    assert.equal(h.status, 200)
    assert.equal(h.json.appointments.length, 1)
    assert.equal(h.json.prescriptions.length, 1)
    const stranger = await login('doctor4@vitalink.test', DEMO.doctorPassword)
    assert.equal((await api('GET', `/api/patients/${patient.user.id}/history`, { token: stranger })).status, 403)
    const other = await register('nosy@x.test')
    assert.equal((await api('GET', `/api/patients/${patient.user.id}/history`, { token: other.token })).status, 403)
    assert.equal((await api('GET', '/api/patients/me/history', { token: patient.token })).status, 200)
    const list = await api('GET', '/api/patients', { token: doc })
    assert.equal(list.json.length, 1)
  })

  it('delivers medicine: prescription-only drugs need a prescription', async () => {
    const addr = '12 Park Street, Kolkata 700016'
    const noRx = await api('POST', '/api/orders', { token: patient.token, body: { items: [{ name: 'Amoxicillin 500mg', qty: 1 }], address: addr } })
    assert.equal(noRx.status, 422)
    assert.equal(noRx.json.code, 'prescription_required')

    const otc = await api('POST', '/api/orders', { token: patient.token, body: { items: [{ name: 'Paracetamol 500mg', qty: 2 }], address: addr } })
    assert.equal(otc.status, 201)
    assert.equal(otc.json.items[0].source, 'otc')

    const withRx = await api('POST', '/api/orders', {
      token: patient.token,
      body: { items: [{ name: 'Cetirizine 10mg', qty: 1 }, { name: 'Paracetamol 500mg', qty: 1 }], address: addr, prescriptionId: rxId },
    })
    assert.equal(withRx.status, 201)
    assert.deepEqual(withRx.json.items.map((i: any) => i.source), ['prescription', 'otc'])

    const id = withRx.json.id
    assert.equal((await api('PATCH', `/api/orders/${id}/status`, { token: doc, body: { status: 'delivered' } })).status, 400) // can't skip stages
    for (const s of ['packed', 'out_for_delivery', 'delivered']) {
      const r = await api('PATCH', `/api/orders/${id}/status`, { token: doc, body: { status: s } })
      assert.equal(r.json.status, s)
    }
    assert.equal((await api('DELETE', `/api/orders/${id}`, { token: patient.token })).status, 409) // delivered
    const cancel = await api('DELETE', `/api/orders/${otc.json.id}`, { token: patient.token })
    assert.equal(cancel.json.status, 'cancelled')
    assert.equal((await api('PATCH', `/api/orders/${id}/status`, { token: patient.token, body: { status: 'packed' } })).status, 403)
  })
})

describe('robustness', () => {
  it('returns JSON errors for bad input and unknown routes', async () => {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })
    assert.equal(res.status, 400)
    assert.equal((await api('GET', '/api/nope')).status, 404)
    const big = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(200_000) }) })
    assert.equal(big.status, 413)
  })
})
