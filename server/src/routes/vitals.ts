import { Router, type Request } from 'express'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { me, requireAuth, requireRole, sha256, verifyToken, type AuthUser } from '../auth.js'
import type { DB } from '../db.js'
import { badRequest, forbidden, notFound, unauthorized } from '../errors.js'
import { evaluate, type AgeGroup, type Finding } from '../services/anomaly.js'
import { distanceKm, doctorView, getDoctorByUser, listDoctors, type DoctorRow } from '../services/doctors.js'
import { dispatch } from '../services/notify.js'

const DEDUPE_MS = 5 * 60_000

const Reading = z.object({
  hr: z.number().min(20).max(300),
  tempC: z.number().min(25).max(45),
  fall: z.boolean().optional(),
  ts: z.union([z.string().datetime({ offset: true }), z.number().int()]).optional(),
})
const Device = z.object({ label: z.string().trim().min(1).max(60) })

interface PatientRow {
  id: string
  name: string
  age_group: AgeGroup
  lat: number | null
  lng: number | null
}

/** Nearest on-duty doctor, preferring the specialty that fits the patient's age group. */
export function pickDoctor(db: DB, p: PatientRow): { doctor: DoctorRow; distanceKm: number | null } | null {
  const duty = listDoctors(db).filter((d) => d.on_duty)
  if (!duty.length) return null
  const prefer = p.age_group === 'senior' ? ['Geriatrics', 'General Medicine'] : p.age_group === 'adult' ? ['General Medicine'] : ['Pediatrics', 'General Medicine']
  let pool: DoctorRow[] = []
  for (const s of prefer) {
    pool = duty.filter((d) => d.specialty === s)
    if (pool.length) break
  }
  if (!pool.length) pool = duty
  const hasPos = p.lat != null && p.lng != null
  const ranked = pool
    .map((doctor) => ({ doctor, distanceKm: hasPos ? distanceKm(p.lat!, p.lng!, doctor.lat, doctor.lng) : null }))
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
  const best = ranked[0]
  return { doctor: best.doctor, distanceKm: best.distanceKm == null ? null : Math.round(best.distanceKm * 10) / 10 }
}

interface AlertRow {
  id: string
  patient_id: string
  kind: string
  severity: string
  message: string
  reading: string
  doctor_id: string | null
  status: string
  created_at: number
  acked_at: number | null
  patient_name: string
  doctor_name: string | null
}
const ALERT_SELECT = `SELECT al.*, pu.name AS patient_name, du.name AS doctor_name
  FROM alerts al JOIN users pu ON pu.id = al.patient_id
  LEFT JOIN doctors d ON d.id = al.doctor_id LEFT JOIN users du ON du.id = d.user_id`

export function alertView(db: DB, a: AlertRow) {
  const notified = db
    .prepare('SELECT recipient_type AS type, recipient_name AS name, channel, status FROM notifications WHERE alert_id = ?')
    .all(a.id) as unknown as { type: string; name: string; channel: string; status: string }[]
  return {
    id: a.id,
    patient: { id: a.patient_id, name: a.patient_name },
    kind: a.kind,
    severity: a.severity,
    message: a.message,
    reading: JSON.parse(a.reading) as unknown,
    doctor: a.doctor_id ? { id: a.doctor_id, name: a.doctor_name } : null,
    status: a.status,
    createdAt: new Date(a.created_at).toISOString(),
    ackedAt: a.acked_at ? new Date(a.acked_at).toISOString() : null,
    notified,
  }
}

export function vitalsRoutes({ db, cfg, now, bus }: Ctx) {
  const r = Router()

  /* ---------------- bands ---------------- */
  r.post('/devices', requireRole('patient'), (req, res) => {
    const b = Device.parse(req.body)
    const id = randomUUID()
    const secret = randomBytes(24).toString('base64url')
    db.prepare('INSERT INTO devices (id,patient_id,label,key_hash,created_at) VALUES (?,?,?,?,?)').run(id, me(res).id, b.label, sha256(secret), now())
    // the key is shown once: the band stores it and sends it as the x-device-key header
    res.status(201).json({ id, label: b.label, key: `${id}.${secret}` })
  })

  r.get('/devices', requireRole('patient'), (_req, res) => {
    const rows = db.prepare('SELECT id, label, created_at, last_seen FROM devices WHERE patient_id = ?').all(me(res).id) as unknown as {
      id: string
      label: string
      created_at: number
      last_seen: number | null
    }[]
    res.json(rows.map((d) => ({ id: d.id, label: d.label, createdAt: new Date(d.created_at).toISOString(), lastSeen: d.last_seen ? new Date(d.last_seen).toISOString() : null })))
  })

  r.delete('/devices/:id', requireRole('patient'), (req, res) => {
    const info = db.prepare('DELETE FROM devices WHERE id = ? AND patient_id = ?').run(String(req.params.id), me(res).id)
    if (!info.changes) throw notFound('Device not found')
    res.status(204).end()
  })

  function deviceFromKey(req: Request) {
    const key = req.headers['x-device-key']
    if (typeof key !== 'string') throw unauthorized('Missing x-device-key header')
    const dot = key.indexOf('.')
    if (dot < 1) throw unauthorized('Invalid device key')
    const d = db.prepare('SELECT id, patient_id, key_hash FROM devices WHERE id = ?').get(key.slice(0, dot)) as unknown as
      | { id: string; patient_id: string; key_hash: string }
      | undefined
    const given = Buffer.from(sha256(key.slice(dot + 1)))
    const want = Buffer.from(d?.key_hash ?? '0'.repeat(64))
    if (!d || given.length !== want.length || !timingSafeEqual(given, want)) throw unauthorized('Invalid device key')
    return d
  }

  /* ---------------- ingest + anomaly detection + alert dispatch ---------------- */
  r.post('/vitals', (req, res) => {
    const dev = deviceFromKey(req)
    const b = Reading.parse(req.body)
    const t = now()
    const ts = b.ts == null ? t : typeof b.ts === 'number' ? b.ts : Date.parse(b.ts)
    if (ts > t + 60_000) throw badRequest('Reading timestamp is in the future')

    const patient = db.prepare('SELECT id, name, age_group, lat, lng FROM users WHERE id = ?').get(dev.patient_id) as unknown as PatientRow
    const recent = (
      db.prepare('SELECT hr FROM vitals WHERE patient_id = ? ORDER BY ts DESC LIMIT 10').all(patient.id) as unknown as { hr: number }[]
    )
      .map((x) => x.hr)
      .reverse()

    db.prepare('INSERT INTO vitals (patient_id,device_id,ts,hr,temp_c,fall) VALUES (?,?,?,?,?,?)').run(patient.id, dev.id, ts, b.hr, b.tempC, b.fall ? 1 : 0)
    db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(t, dev.id)

    const findings: Finding[] = evaluate({ hr: b.hr, tempC: b.tempC, fall: !!b.fall }, patient.age_group, recent)
    const created: ReturnType<typeof alertView>[] = []

    for (const f of findings) {
      const dup = db
        .prepare(`SELECT 1 FROM alerts WHERE patient_id = ? AND kind = ? AND status = 'open' AND created_at > ? LIMIT 1`)
        .get(patient.id, f.kind, t - DEDUPE_MS)
      if (dup) continue // already alerted for this recently; don't spam the doctor and family

      const pick = pickDoctor(db, patient)
      const id = randomUUID()
      db.prepare('INSERT INTO alerts (id,patient_id,kind,severity,message,reading,doctor_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        id, patient.id, f.kind, f.severity, f.message, JSON.stringify({ hr: b.hr, tempC: b.tempC, fall: !!b.fall, at: new Date(ts).toISOString() }),
        pick?.doctor.id ?? null, 'open', t,
      )
      const family = db.prepare('SELECT name, phone FROM family_contacts WHERE patient_id = ?').all(patient.id) as unknown as { name: string; phone: string }[]
      dispatch(
        db, cfg,
        { id, kind: f.kind, severity: f.severity, message: f.message, patientName: patient.name },
        [
          ...(pick ? [{ type: 'doctor' as const, name: pick.doctor.name, ref: pick.doctor.user_id }] : []),
          ...family.map((m) => ({ type: 'family' as const, name: m.name, ref: m.phone })),
        ],
      )
      const view = alertView(db, db.prepare(`${ALERT_SELECT} WHERE al.id = ?`).get(id) as unknown as AlertRow)
      created.push(view)
      bus.publish([patient.id, ...(pick ? [pick.doctor.user_id] : [])], { type: 'alert', data: view })
    }

    res.status(201).json({
      reading: { hr: b.hr, tempC: b.tempC, fall: !!b.fall, at: new Date(ts).toISOString() },
      anomalous: findings.length > 0,
      findings,
      alerts: created,
    })
  })

  r.get('/vitals', requireRole('patient'), (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50))
    const rows = db.prepare('SELECT ts, hr, temp_c, fall FROM vitals WHERE patient_id = ? ORDER BY ts DESC LIMIT ?').all(me(res).id, limit) as unknown as {
      ts: number
      hr: number
      temp_c: number
      fall: number
    }[]
    res.json(rows.map((v) => ({ at: new Date(v.ts).toISOString(), hr: v.hr, tempC: v.temp_c, fall: !!v.fall })))
  })

  /* ---------------- alerts ---------------- */
  r.get('/alerts', requireAuth, (req, res) => {
    const u = me(res)
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    let rows: AlertRow[]
    if (u.role === 'patient') {
      rows = db.prepare(`${ALERT_SELECT} WHERE al.patient_id = ? ORDER BY al.created_at DESC LIMIT 200`).all(u.id) as unknown as AlertRow[]
    } else {
      const d = getDoctorByUser(db, u.id)
      rows = d ? (db.prepare(`${ALERT_SELECT} WHERE al.doctor_id = ? ORDER BY al.created_at DESC LIMIT 200`).all(d.id) as unknown as AlertRow[]) : []
    }
    res.json((status ? rows.filter((a) => a.status === status) : rows).map((a) => alertView(db, a)))
  })

  r.patch('/alerts/:id/ack', requireRole('doctor'), (req, res) => {
    const a = db.prepare(`${ALERT_SELECT} WHERE al.id = ?`).get(String(req.params.id)) as unknown as AlertRow | undefined
    if (!a) throw notFound('Alert not found')
    const d = getDoctorByUser(db, me(res).id)
    if (!d || a.doctor_id !== d.id) throw forbidden('This alert is assigned to another doctor')
    if (a.status === 'open') db.prepare(`UPDATE alerts SET status = 'acknowledged', acked_at = ? WHERE id = ?`).run(now(), a.id)
    const view = alertView(db, db.prepare(`${ALERT_SELECT} WHERE al.id = ?`).get(a.id) as unknown as AlertRow)
    bus.publish([a.patient_id], { type: 'alert_ack', data: view })
    res.json(view)
  })

  /* ---------------- live stream (Server-Sent Events) ---------------- */
  r.get('/stream', (req, res) => {
    // EventSource cannot set headers, so this one endpoint also accepts ?token=
    const raw = typeof req.query.token === 'string' ? req.query.token : req.headers.authorization?.replace(/^Bearer /, '')
    const u: AuthUser | null = raw ? verifyToken(raw, cfg.jwtSecret) : null
    if (!u) throw unauthorized()
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(`event: ready\ndata: ${JSON.stringify({ userId: u.id })}\n\n`)
    const off = bus.subscribe(u.id, (e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`))
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 25_000)
    req.on('close', () => {
      clearInterval(beat)
      off()
    })
  })

  // doctor dashboard helper: who is on duty and where (read-only)
  r.get('/on-duty', requireAuth, (_req, res) => {
    res.json(listDoctors(db).filter((d) => d.on_duty).map(doctorView))
  })

  return r
}
