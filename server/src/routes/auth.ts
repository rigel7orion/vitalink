import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { hashPassword, me, requireAuth, signToken, verifyPassword } from '../auth.js'
import { isUniqueViolation } from '../db.js'
import { conflict, notFound, unauthorized } from '../errors.js'
import { doctorView, getDoctorByUser } from '../services/doctors.js'

const AGE = z.enum(['infant', 'child', 'adult', 'senior'])
const Register = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(8).max(200),
  ageGroup: AGE.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})
const Login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) })
const Patch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  ageGroup: AGE.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})

interface UserRow {
  id: string
  name: string
  email: string
  pass_hash: string
  role: 'patient' | 'doctor'
  age_group: string
  lat: number | null
  lng: number | null
}
const view = (u: UserRow) => ({ id: u.id, name: u.name, email: u.email, role: u.role, ageGroup: u.age_group, lat: u.lat, lng: u.lng })

export function authRoutes({ db, cfg, authLimiter }: Ctx) {
  const r = Router()

  r.post('/auth/register', authLimiter, (req, res) => {
    const b = Register.parse(req.body)
    const id = randomUUID()
    try {
      db.prepare('INSERT INTO users (id,name,email,pass_hash,role,age_group,lat,lng,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        id, b.name, b.email, hashPassword(b.password), 'patient', b.ageGroup ?? 'adult', b.lat ?? null, b.lng ?? null, Date.now(),
      )
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('An account with this email already exists', 'email_taken')
      throw e
    }
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow
    res.status(201).json({ token: signToken({ id, role: 'patient' }, cfg.jwtSecret), user: view(u) })
  })

  r.post('/auth/login', authLimiter, (req, res) => {
    const b = Login.parse(req.body)
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(b.email) as unknown as UserRow | undefined
    // same error for unknown email and wrong password
    if (!u || !verifyPassword(b.password, u.pass_hash)) throw unauthorized('Invalid email or password')
    res.json({ token: signToken({ id: u.id, role: u.role }, cfg.jwtSecret), user: view(u) })
  })

  r.get('/me', requireAuth, (_req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(me(res).id) as unknown as UserRow | undefined
    if (!u) throw notFound('Account no longer exists')
    const d = u.role === 'doctor' ? getDoctorByUser(db, u.id) : undefined
    res.json({ ...view(u), doctor: d ? doctorView(d) : undefined })
  })

  r.patch('/me', requireAuth, (req, res) => {
    const b = Patch.parse(req.body)
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(me(res).id) as unknown as UserRow
    db.prepare('UPDATE users SET name = ?, age_group = ?, lat = ?, lng = ? WHERE id = ?').run(
      b.name ?? u.name, b.ageGroup ?? u.age_group, b.lat ?? u.lat, b.lng ?? u.lng, u.id,
    )
    res.json(view(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id) as unknown as UserRow))
  })

  return r
}
