import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { me, requireAuth, requireRole } from '../auth.js'
import type { DB } from '../db.js'
import { badRequest, conflict, forbidden, HttpError, notFound } from '../errors.js'
import { getDoctorByUser } from '../services/doctors.js'
import { apptView, getAppt } from './appointments.js'

const Item = z.object({
  name: z.string().trim().min(1).max(80),
  dose: z.string().trim().min(1).max(40),
  frequency: z.string().trim().min(1).max(40),
  days: z.number().int().min(1).max(90),
})
const Rx = z.object({
  appointmentId: z.string().min(1),
  items: z.array(Item).min(1).max(20),
  notes: z.string().trim().max(1000).optional(),
})
const OrderItem = z.object({ name: z.string().trim().min(1).max(80), qty: z.number().int().min(1).max(20) })
const OrderBody = z.object({
  items: z.array(OrderItem).min(1).max(30),
  address: z.string().trim().min(8).max(300),
  prescriptionId: z.string().optional(),
})
const Family = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Invalid phone number'),
  relation: z.string().trim().max(40).optional(),
})

// Drugs that must never be sold as "OTC" through the delivery flow.
const PRESCRIPTION_ONLY =
  /\b(amoxicillin|azithromycin|ciprofloxacin|doxycycline|cefixime|tramadol|morphine|codeine|fentanyl|alprazolam|diazepam|clonazepam|lorazepam|zolpidem|insulin|metformin|atorvastatin|prednisolone|amlodipine)\b/i

const NEXT: Record<string, string> = { placed: 'packed', packed: 'out_for_delivery', out_for_delivery: 'delivered' }

interface RxRow {
  id: string
  appointment_id: string
  patient_id: string
  doctor_id: string
  items: string
  notes: string
  created_at: number
  doctor_name: string
  patient_name: string
  booking_id: string
}
const RX_SELECT = `SELECT p.*, du.name AS doctor_name, pu.name AS patient_name, a.booking_id AS booking_id
  FROM prescriptions p
  JOIN doctors d ON d.id = p.doctor_id JOIN users du ON du.id = d.user_id
  JOIN users pu ON pu.id = p.patient_id
  JOIN appointments a ON a.id = p.appointment_id`
const rxView = (p: RxRow) => ({
  id: p.id,
  appointmentId: p.appointment_id,
  bookingId: p.booking_id,
  doctor: { id: p.doctor_id, name: p.doctor_name },
  patient: { id: p.patient_id, name: p.patient_name },
  items: JSON.parse(p.items) as z.infer<typeof Item>[],
  notes: p.notes,
  createdAt: new Date(p.created_at).toISOString(),
})

interface OrderRow {
  id: string
  patient_id: string
  prescription_id: string | null
  items: string
  address: string
  status: string
  created_at: number
  updated_at: number
}
const orderView = (o: OrderRow) => ({
  id: o.id,
  patientId: o.patient_id,
  prescriptionId: o.prescription_id,
  items: JSON.parse(o.items) as { name: string; qty: number; source: 'prescription' | 'otc' }[],
  address: o.address,
  status: o.status,
  createdAt: new Date(o.created_at).toISOString(),
  updatedAt: new Date(o.updated_at).toISOString(),
})

/** Doctors may see a patient only if they have an appointment with them. */
function canSeePatient(db: DB, u: { id: string; role: string }, patientId: string): boolean {
  if (u.role === 'patient') return u.id === patientId
  const d = getDoctorByUser(db, u.id)
  if (!d) return false
  return !!db.prepare(`SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ? AND status != 'cancelled' LIMIT 1`).get(d.id, patientId)
}

export function clinicalRoutes({ db, now, bus }: Ctx) {
  const r = Router()

  /* ---------------- e-prescriptions ---------------- */
  r.post('/prescriptions', requireRole('doctor'), (req, res) => {
    const b = Rx.parse(req.body)
    const d = getDoctorByUser(db, me(res).id)
    const a = getAppt(db, b.appointmentId)
    if (!a) throw notFound('Appointment not found')
    if (!d || a.doctor_id !== d.id) throw forbidden('This is not your appointment')
    if (a.status === 'cancelled') throw conflict('Cannot prescribe for a cancelled appointment', 'appointment_cancelled')
    const id = randomUUID()
    db.prepare('INSERT INTO prescriptions (id,appointment_id,patient_id,doctor_id,items,notes,created_at) VALUES (?,?,?,?,?,?,?)').run(
      id, a.id, a.patient_id, d.id, JSON.stringify(b.items), b.notes ?? '', now(),
    )
    bus.publish([a.patient_id], { type: 'prescription', data: { id } })
    res.status(201).json(rxView(db.prepare(`${RX_SELECT} WHERE p.id = ?`).get(id) as unknown as RxRow))
  })

  r.get('/prescriptions', requireAuth, (_req, res) => {
    const u = me(res)
    let rows: RxRow[]
    if (u.role === 'patient') {
      rows = db.prepare(`${RX_SELECT} WHERE p.patient_id = ? ORDER BY p.created_at DESC`).all(u.id) as unknown as RxRow[]
    } else {
      const d = getDoctorByUser(db, u.id)
      rows = d ? (db.prepare(`${RX_SELECT} WHERE p.doctor_id = ? ORDER BY p.created_at DESC`).all(d.id) as unknown as RxRow[]) : []
    }
    res.json(rows.map(rxView))
  })

  r.get('/prescriptions/:id', requireAuth, (req, res) => {
    const p = db.prepare(`${RX_SELECT} WHERE p.id = ?`).get(String(req.params.id)) as unknown as RxRow | undefined
    if (!p) throw notFound('Prescription not found')
    if (!canSeePatient(db, me(res), p.patient_id)) throw forbidden()
    res.json(rxView(p))
  })

  /* ---------------- unified patient history ---------------- */
  r.get('/patients', requireRole('doctor'), (_req, res) => {
    const d = getDoctorByUser(db, me(res).id)
    if (!d) return res.json([])
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.age_group, COUNT(*) AS visits, MAX(a.start_ts) AS last_visit
         FROM appointments a JOIN users u ON u.id = a.patient_id
         WHERE a.doctor_id = ? AND a.status != 'cancelled' GROUP BY u.id ORDER BY last_visit DESC`,
      )
      .all(d.id) as unknown as { id: string; name: string; age_group: string; visits: number; last_visit: number }[]
    res.json(rows.map((p) => ({ id: p.id, name: p.name, ageGroup: p.age_group, visits: p.visits, lastVisit: new Date(p.last_visit).toISOString() })))
  })

  r.get('/patients/:id/history', requireAuth, (req, res) => {
    const u = me(res)
    const pid = req.params.id === 'me' ? u.id : String(req.params.id)
    if (!canSeePatient(db, u, pid)) throw forbidden('You do not have access to this patient')
    const p = db.prepare('SELECT id, name, age_group FROM users WHERE id = ?').get(pid) as unknown as { id: string; name: string; age_group: string } | undefined
    if (!p) throw notFound('Patient not found')
    const appts = db
      .prepare(`SELECT a.id FROM appointments a WHERE a.patient_id = ? ORDER BY a.start_ts DESC LIMIT 100`)
      .all(pid) as unknown as { id: string }[]
    const latest = db.prepare('SELECT ts, hr, temp_c, fall FROM vitals WHERE patient_id = ? ORDER BY ts DESC LIMIT 1').get(pid) as unknown as
      | { ts: number; hr: number; temp_c: number; fall: number }
      | undefined
    const alerts = db
      .prepare('SELECT id, kind, severity, message, status, created_at FROM alerts WHERE patient_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(pid) as unknown as { id: string; kind: string; severity: string; message: string; status: string; created_at: number }[]
    res.json({
      patient: { id: p.id, name: p.name, ageGroup: p.age_group },
      appointments: appts.map((a) => apptView(getAppt(db, a.id)!)),
      prescriptions: (db.prepare(`${RX_SELECT} WHERE p.patient_id = ? ORDER BY p.created_at DESC`).all(pid) as unknown as RxRow[]).map(rxView),
      orders: (db.prepare('SELECT * FROM orders WHERE patient_id = ? ORDER BY created_at DESC LIMIT 50').all(pid) as unknown as OrderRow[]).map(orderView),
      latestVitals: latest ? { at: new Date(latest.ts).toISOString(), hr: latest.hr, tempC: latest.temp_c, fall: !!latest.fall } : null,
      alerts: alerts.map((a) => ({ ...a, createdAt: new Date(a.created_at).toISOString() })),
    })
  })

  /* ---------------- medicine delivery ---------------- */
  r.post('/orders', requireRole('patient'), (req, res) => {
    const b = OrderBody.parse(req.body)
    const u = me(res)
    let rxNames: string[] = []
    if (b.prescriptionId) {
      const p = db.prepare('SELECT patient_id, items FROM prescriptions WHERE id = ?').get(b.prescriptionId) as unknown as { patient_id: string; items: string } | undefined
      if (!p || p.patient_id !== u.id) throw notFound('Prescription not found')
      rxNames = (JSON.parse(p.items) as { name: string }[]).map((i) => i.name.toLowerCase())
    }
    const items = b.items.map((i) => {
      const onRx = rxNames.some((n) => n.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(n))
      if (!onRx && PRESCRIPTION_ONLY.test(i.name)) {
        throw new HttpError(422, `${i.name} needs a valid prescription from your doctor`, 'prescription_required')
      }
      return { name: i.name, qty: i.qty, source: onRx ? ('prescription' as const) : ('otc' as const) }
    })
    const id = randomUUID()
    const t = now()
    db.prepare(`INSERT INTO orders (id,patient_id,prescription_id,items,address,status,created_at,updated_at) VALUES (?,?,?,?,?,'placed',?,?)`).run(
      id, u.id, b.prescriptionId ?? null, JSON.stringify(items), b.address, t, t,
    )
    res.status(201).json(orderView(db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as unknown as OrderRow))
  })

  r.get('/orders', requireRole('patient'), (_req, res) => {
    const rows = db.prepare('SELECT * FROM orders WHERE patient_id = ? ORDER BY created_at DESC').all(me(res).id) as unknown as OrderRow[]
    res.json(rows.map(orderView))
  })

  r.get('/orders/:id', requireAuth, (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(req.params.id)) as unknown as OrderRow | undefined
    if (!o) throw notFound('Order not found')
    if (!canSeePatient(db, me(res), o.patient_id)) throw forbidden()
    res.json(orderView(o))
  })

  // clinic pharmacy staff (doctor accounts) move an order through its stages
  r.patch('/orders/:id/status', requireRole('doctor'), (req, res) => {
    const { status } = z.object({ status: z.enum(['packed', 'out_for_delivery', 'delivered']) }).parse(req.body)
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(req.params.id)) as unknown as OrderRow | undefined
    if (!o) throw notFound('Order not found')
    if (!canSeePatient(db, me(res), o.patient_id)) throw forbidden()
    if (NEXT[o.status] !== status) throw badRequest(`Order is ${o.status}; the next status must be ${NEXT[o.status] ?? 'none (final)'}`, 'bad_transition')
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), o.id)
    bus.publish([o.patient_id], { type: 'order', data: { id: o.id, status } })
    res.json(orderView(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id) as unknown as OrderRow))
  })

  r.delete('/orders/:id', requireRole('patient'), (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(req.params.id)) as unknown as OrderRow | undefined
    if (!o || o.patient_id !== me(res).id) throw notFound('Order not found')
    if (o.status !== 'placed') throw conflict(`Order is already ${o.status} and can no longer be cancelled`, 'not_cancellable')
    db.prepare(`UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now(), o.id)
    res.json(orderView(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id) as unknown as OrderRow))
  })

  /* ---------------- family contacts (alert recipients) ---------------- */
  r.get('/family', requireRole('patient'), (_req, res) => {
    res.json(db.prepare('SELECT id, name, phone, relation FROM family_contacts WHERE patient_id = ?').all(me(res).id))
  })
  r.post('/family', requireRole('patient'), (req, res) => {
    const b = Family.parse(req.body)
    const n = (db.prepare('SELECT COUNT(*) AS n FROM family_contacts WHERE patient_id = ?').get(me(res).id) as { n: number }).n
    if (n >= 10) throw conflict('You can add up to 10 family contacts', 'limit')
    const id = randomUUID()
    db.prepare('INSERT INTO family_contacts (id,patient_id,name,phone,relation) VALUES (?,?,?,?,?)').run(id, me(res).id, b.name, b.phone, b.relation ?? '')
    res.status(201).json({ id, name: b.name, phone: b.phone, relation: b.relation ?? '' })
  })
  r.delete('/family/:id', requireRole('patient'), (req, res) => {
    const info = db.prepare('DELETE FROM family_contacts WHERE id = ? AND patient_id = ?').run(String(req.params.id), me(res).id)
    if (!info.changes) throw notFound('Contact not found')
    res.status(204).end()
  })

  return r
}
