import { Router } from 'express'
import type { Ctx } from '../app.js'
import { badRequest, notFound } from '../errors.js'
import { clinicDate, isDate } from '../time.js'
import { doctorView, getDoctor, listDoctors, nextFreeSlot, queueFor, slotsFor } from '../services/doctors.js'

export function doctorRoutes({ db, cfg, now }: Ctx) {
  const r = Router()

  r.get('/doctors', (req, res) => {
    const specialty = typeof req.query.specialty === 'string' ? req.query.specialty : undefined
    const t = now()
    res.json(
      listDoctors(db, specialty).map((d) => {
        const next = nextFreeSlot(db, cfg, d, t)
        return { ...doctorView(d), nextFreeSlot: next ? new Date(next.start).toISOString() : null }
      }),
    )
  })

  r.get('/specialties', (_req, res) => {
    res.json([...new Set(listDoctors(db).map((d) => d.specialty))].sort())
  })

  r.get('/doctors/:id', (req, res) => {
    const d = getDoctor(db, String(req.params.id))
    if (!d) throw notFound('Doctor not found')
    res.json(doctorView(d))
  })

  r.get('/doctors/:id/slots', (req, res) => {
    const d = getDoctor(db, String(req.params.id))
    if (!d) throw notFound('Doctor not found')
    const t = now()
    const date = typeof req.query.date === 'string' ? req.query.date : clinicDate(t, cfg.clinicOffsetMin)
    if (!isDate(date)) throw badRequest('date must be YYYY-MM-DD')
    res.json({
      doctorId: d.id,
      date,
      slots: slotsFor(db, cfg, d, date, t).map((s) => ({
        start: new Date(s.start).toISOString(),
        end: new Date(s.end).toISOString(),
        available: s.available,
      })),
    })
  })

  // the "invisible wait", made visible
  r.get('/doctors/:id/queue', (req, res) => {
    const d = getDoctor(db, String(req.params.id))
    if (!d) throw notFound('Doctor not found')
    res.json(queueFor(db, cfg, d, now()))
  })

  return r
}
