import type { DB } from '../db.js'
import type { Config } from '../config.js'
import { addDays, clinicDate, clinicToUtc, dayOfWeek } from '../time.js'

export const SLOT_MIN = 30

export interface DoctorRow {
  id: string
  user_id: string
  name: string
  specialty: string
  code: string
  city: string
  lat: number
  lng: number
  room: string
  fee: number
  shift_start: number
  shift_end: number
  avg_consult_min: number
  on_duty: number
}

const BASE = `SELECT d.*, u.name AS name FROM doctors d JOIN users u ON u.id = d.user_id`

export const getDoctor = (db: DB, id: string) =>
  db.prepare(`${BASE} WHERE d.id = ?`).get(id) as unknown as DoctorRow | undefined

export const getDoctorByUser = (db: DB, userId: string) =>
  db.prepare(`${BASE} WHERE d.user_id = ?`).get(userId) as unknown as DoctorRow | undefined

export function listDoctors(db: DB, specialty?: string): DoctorRow[] {
  const rows = db.prepare(`${BASE} ORDER BY d.specialty, u.name`).all() as unknown as DoctorRow[]
  if (!specialty) return rows
  const s = specialty.toLowerCase()
  return rows.filter((r) => r.specialty.toLowerCase() === s)
}

export const doctorView = (d: DoctorRow) => ({
  id: d.id,
  name: d.name,
  specialty: d.specialty,
  city: d.city,
  room: d.room,
  fee: d.fee,
  lat: d.lat,
  lng: d.lng,
  avgConsultMin: d.avg_consult_min,
  onDuty: !!d.on_duty,
  shift: { start: d.shift_start, end: d.shift_end },
})

export interface Slot {
  start: number
  end: number
  available: boolean
}

/** All future slots of a doctor on a clinic-local date; `available` is false when already booked. */
export function slotsFor(db: DB, cfg: Config, d: DoctorRow, date: string, now: number): Slot[] {
  if (!d.on_duty || dayOfWeek(date) === 0) return [] // closed Sundays
  const dayStart = clinicToUtc(date, 0, 0, cfg.clinicOffsetMin)
  const rows = db
    .prepare(`SELECT start_ts FROM appointments WHERE doctor_id = ? AND status = 'booked' AND start_ts >= ? AND start_ts < ?`)
    .all(d.id, dayStart, dayStart + 86_400_000) as unknown as { start_ts: number }[]
  const taken = new Set(rows.map((r) => r.start_ts))
  const out: Slot[] = []
  for (let min = d.shift_start * 60; min < d.shift_end * 60; min += SLOT_MIN) {
    const start = clinicToUtc(date, Math.floor(min / 60), min % 60, cfg.clinicOffsetMin)
    if (start <= now) continue
    out.push({ start, end: start + SLOT_MIN * 60_000, available: !taken.has(start) })
  }
  return out
}

export function nextFreeSlot(db: DB, cfg: Config, d: DoctorRow, now: number): Slot | null {
  const today = clinicDate(now, cfg.clinicOffsetMin)
  for (let i = 0; i < 14; i++) {
    const s = slotsFor(db, cfg, d, addDays(today, i), now).find((x) => x.available)
    if (s) return s
  }
  return null
}

/** Today's queue: how many are still booked from now on, and the wait a walk-in would face. */
export function queueFor(db: DB, cfg: Config, d: DoctorRow, now: number) {
  const today = clinicDate(now, cfg.clinicOffsetMin)
  const dayEnd = clinicToUtc(today, 0, 0, cfg.clinicOffsetMin) + 86_400_000
  const remaining = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM appointments WHERE doctor_id = ? AND status = 'booked' AND start_ts >= ? AND start_ts < ?`)
      .get(d.id, now, dayEnd) as { n: number }
  ).n
  const next = nextFreeSlot(db, cfg, d, now)
  return {
    doctorId: d.id,
    date: today,
    remainingToday: remaining,
    avgConsultMin: d.avg_consult_min,
    estimatedWaitMin: Math.round(remaining * d.avg_consult_min),
    nextFreeSlot: next ? { start: new Date(next.start).toISOString(), end: new Date(next.end).toISOString() } : null,
  }
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
