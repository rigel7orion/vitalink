import { Router } from 'express'
import type { Ctx } from '../app.js'
import { me, requireRole } from '../auth.js'
import { forbidden } from '../errors.js'
import { getDoctorByUser } from '../services/doctors.js'
import type { InvoiceRow, Line } from '../services/billing.js'

const DAY = 86_400_000

/** Doctor's own numbers: today's queue, patients, earnings, recent bills. Doctors only, and only their own data. */
export function dashboardRoutes({ db, cfg, now }: Ctx) {
  const r = Router()

  r.get('/doctor/dashboard', requireRole('doctor'), (_req, res) => {
    const d = getDoctorByUser(db, me(res).id)
    if (!d) throw forbidden('No doctor profile for this account')

    const off = cfg.clinicOffsetMin * 60_000
    const t = now()
    const dayStart = Math.floor((t + off) / DAY) * DAY - off // clinic-local midnight, as UTC ms
    const dayKey = (ms: number) => new Date(ms + off).toISOString().slice(0, 10)

    // ---- today ----
    const today = db
      .prepare(
        `SELECT a.id, a.booking_id, a.token, a.start_ts, a.status, a.reason, u.name AS patient_name
         FROM appointments a JOIN users u ON u.id = a.patient_id
         WHERE a.doctor_id = ? AND a.start_ts >= ? AND a.start_ts < ? ORDER BY a.start_ts`,
      )
      .all(d.id, dayStart, dayStart + DAY) as unknown as { id: string; booking_id: string; token: string; start_ts: number; status: string; reason: string; patient_name: string }[]

    // ---- patients (distinct, with visit counts) ----
    const patients = db
      .prepare(
        `SELECT u.id, u.name, COUNT(*) AS visits, MAX(a.start_ts) AS last_visit
         FROM appointments a JOIN users u ON u.id = a.patient_id
         WHERE a.doctor_id = ? AND a.status != 'cancelled'
         GROUP BY u.id ORDER BY last_visit DESC LIMIT 12`,
      )
      .all(d.id) as unknown as { id: string; name: string; visits: number; last_visit: number }[]
    const totalPatients = (db.prepare(`SELECT COUNT(DISTINCT patient_id) AS n FROM appointments WHERE doctor_id = ? AND status != 'cancelled'`).get(d.id) as { n: number }).n

    // ---- money: the doctor earns the consultation line; the platform fee is VITALINK's ----
    const invs = db.prepare('SELECT * FROM invoices WHERE doctor_id = ? ORDER BY issued_at DESC').all(d.id) as unknown as InvoiceRow[]
    const consult = (i: InvoiceRow) => {
      const l = (JSON.parse(i.lines) as Line[])[0]
      return l ? l.amountPaise + l.taxPaise : 0
    }
    let paid = 0
    let pending = 0
    let refunded = 0
    const byDay = new Map<string, number>()
    for (let k = 6; k >= 0; k--) byDay.set(dayKey(t - k * DAY), 0)
    for (const i of invs) {
      const c = consult(i)
      if (i.status === 'paid') {
        paid += c
        const k = dayKey(i.paid_at ?? i.issued_at)
        if (byDay.has(k)) byDay.set(k, byDay.get(k)! + c)
      } else if (i.status === 'pending') pending += c
      else if (i.status === 'refunded') refunded += c
    }

    res.json({
      doctor: { id: d.id, specialty: d.specialty, room: d.room },
      today: {
        total: today.length,
        booked: today.filter((a) => a.status === 'booked').length,
        completed: today.filter((a) => a.status === 'completed').length,
        appointments: today.map((a) => ({ id: a.id, bookingId: a.booking_id, token: a.token, start: new Date(a.start_ts).toISOString(), status: a.status, reason: a.reason, patient: a.patient_name })),
      },
      patients: { total: totalPatients, recent: patients.map((p) => ({ id: p.id, name: p.name, visits: p.visits, lastVisit: new Date(p.last_visit).toISOString() })) },
      earnings: {
        currency: 'INR' as const,
        paidPaise: paid,
        pendingPaise: pending,
        refundedPaise: refunded,
        last7Days: [...byDay].map(([date, paise]) => ({ date, paise })),
      },
      recentBills: invs.slice(0, 8).map((i) => ({ id: i.id, invoiceNo: i.invoice_no, patient: i.patient_name, status: i.status, totalPaise: i.total_paise, doctorSharePaise: consult(i), issuedAt: new Date(i.issued_at).toISOString() })),
    })
  })

  return r
}
