import { Router } from 'express'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { me, requireAuth, requireRole } from '../auth.js'
import { isUniqueViolation, tx, type DB } from '../db.js'
import { badRequest, conflict, forbidden, notFound } from '../errors.js'
import { clinicDate, clinicToUtc } from '../time.js'
import { getDoctor, getDoctorByUser, slotsFor, SLOT_MIN } from '../services/doctors.js'
import { createInvoice, getInvoiceByAppt, invoiceView, settleClinicCash, settleOnCancel } from '../services/billing.js'
import { cashRef } from '../services/payments.js'

const Book = z.object({
  doctorId: z.string().min(1),
  start: z.union([z.string().datetime({ offset: true }), z.number().int()]),
  reason: z.string().trim().max(500).optional(),
})

interface ApptRow {
  id: string
  booking_id: string
  patient_id: string
  doctor_id: string
  start_ts: number
  end_ts: number
  status: string
  token: string
  reason: string
  created_at: number
  cancelled_at: number | null
  doctor_name: string
  specialty: string
  room: string
  patient_name: string
}

const SELECT = `SELECT a.*, du.name AS doctor_name, d.specialty AS specialty, d.room AS room, pu.name AS patient_name
  FROM appointments a
  JOIN doctors d ON d.id = a.doctor_id
  JOIN users du ON du.id = d.user_id
  JOIN users pu ON pu.id = a.patient_id`

export const apptView = (a: ApptRow) => ({
  id: a.id,
  bookingId: a.booking_id,
  token: a.token,
  status: a.status,
  start: new Date(a.start_ts).toISOString(),
  end: new Date(a.end_ts).toISOString(),
  reason: a.reason,
  doctor: { id: a.doctor_id, name: a.doctor_name, specialty: a.specialty, room: a.room },
  patient: { id: a.patient_id, name: a.patient_name },
})

export const getAppt = (db: DB, id: string) =>
  db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as unknown as ApptRow | undefined

export function appointmentRoutes({ db, cfg, now }: Ctx) {
  const r = Router()

  r.post('/appointments', requireRole('patient'), (req, res) => {
    const b = Book.parse(req.body)
    const startMs = typeof b.start === 'number' ? b.start : Date.parse(b.start)
    const doc = getDoctor(db, b.doctorId)
    if (!doc) throw notFound('Doctor not found')
    if (!doc.on_duty) throw conflict('Doctor is not taking appointments right now', 'doctor_off_duty')

    // the start must be a real, future slot of this doctor
    const t = now()
    const date = clinicDate(startMs, cfg.clinicOffsetMin)
    const slot = slotsFor(db, cfg, doc, date, t).find((s) => s.start === startMs)
    if (!slot) throw badRequest('That is not a valid upcoming slot for this doctor', 'invalid_slot')
    if (!slot.available) throw conflict('That slot was just taken. Please pick another.', 'slot_taken')

    const patientId = me(res).id
    const id = randomUUID()
    const bookingId = `BK-${doc.code}-${randomBytes(3).toString('hex').toUpperCase()}`
    try {
      tx(db, () => {
        const dayStart = clinicToUtc(date, 0, 0, cfg.clinicOffsetMin)
        const n = (
          db
            .prepare(`SELECT COUNT(*) AS n FROM appointments WHERE doctor_id = ? AND status != 'cancelled' AND start_ts >= ? AND start_ts < ?`)
            .get(doc.id, dayStart, dayStart + 86_400_000) as { n: number }
        ).n
        db.prepare(
          `INSERT INTO appointments (id,booking_id,patient_id,doctor_id,start_ts,end_ts,status,token,reason,created_at)
           VALUES (?,?,?,?,?,?,'booked',?,?,?)`,
        ).run(id, bookingId, patientId, doc.id, startMs, startMs + SLOT_MIN * 60_000, `${doc.code}-${n + 1}`, b.reason ?? '', t)
        // the bill is created in the SAME transaction: no booking without an invoice, no invoice without a booking
        const pu = db.prepare('SELECT name, email FROM users WHERE id = ?').get(patientId) as { name: string; email: string }
        createInvoice(
          db,
          cfg,
          { appointmentId: id, patientId, patientName: pu.name, patientEmail: pu.email, doctorId: doc.id, doctorName: doc.name, specialty: doc.specialty, feeRupees: doc.fee },
          t,
        )
      })
    } catch (e) {
      if (isUniqueViolation(e)) {
        const msg = (e as Error).message
        if (msg.includes('patient_id')) throw conflict('You already have an appointment at that time', 'patient_busy')
        throw conflict('That slot was just taken. Please pick another.', 'slot_taken')
      }
      throw e
    }
    res.status(201).json({ ...apptView(getAppt(db, id)!), invoice: invoiceView(getInvoiceByAppt(db, id)!) })
  })

  r.get('/appointments', requireAuth, (req, res) => {
    const u = me(res)
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    let rows: ApptRow[]
    if (u.role === 'patient') {
      rows = db.prepare(`${SELECT} WHERE a.patient_id = ? ORDER BY a.start_ts DESC`).all(u.id) as unknown as ApptRow[]
    } else {
      const d = getDoctorByUser(db, u.id)
      rows = d ? (db.prepare(`${SELECT} WHERE a.doctor_id = ? ORDER BY a.start_ts DESC`).all(d.id) as unknown as ApptRow[]) : []
    }
    res.json((status ? rows.filter((a) => a.status === status) : rows).map(apptView))
  })

  const owns = (res: Parameters<typeof me>[0], a: ApptRow) => {
    const u = me(res)
    if (u.role === 'patient') return a.patient_id === u.id
    return getDoctorByUser(db, u.id)?.id === a.doctor_id
  }

  r.get('/appointments/:id', requireAuth, (req, res) => {
    const a = getAppt(db, String(req.params.id))
    if (!a) throw notFound('Appointment not found')
    if (!owns(res, a)) throw forbidden()
    res.json(apptView(a))
  })

  // one-tap cancellation: frees the slot immediately
  r.delete('/appointments/:id', requireAuth, (req, res) => {
    const a = getAppt(db, String(req.params.id))
    if (!a) throw notFound('Appointment not found')
    if (!owns(res, a)) throw forbidden()
    if (a.status !== 'booked') throw conflict(`Appointment is already ${a.status}`, 'not_cancellable')
    if (a.start_ts <= now()) throw conflict('This appointment has already started', 'too_late')
    const t = now()
    tx(db, () => {
      db.prepare(`UPDATE appointments SET status = 'cancelled', cancelled_at = ? WHERE id = ?`).run(t, a.id)
      settleOnCancel(db, cfg, a.id, t) // paid -> refunded + credit note, unpaid -> void
    })
    const inv = getInvoiceByAppt(db, a.id)
    res.json({ ...apptView(getAppt(db, a.id)!), ...(inv ? { invoice: invoiceView(inv) } : {}) })
  })

  r.post('/appointments/:id/complete', requireRole('doctor'), (req, res) => {
    const a = getAppt(db, String(req.params.id))
    if (!a) throw notFound('Appointment not found')
    if (!owns(res, a)) throw forbidden()
    if (a.status !== 'booked') throw conflict(`Appointment is already ${a.status}`, 'not_completable')
    tx(db, () => {
      db.prepare(`UPDATE appointments SET status = 'completed' WHERE id = ?`).run(a.id)
      settleClinicCash(db, a.id, now(), cashRef()) // a pay-at-clinic bill is settled in cash at the visit
    })
    res.json(apptView(getAppt(db, a.id)!))
  })

  return r
}
