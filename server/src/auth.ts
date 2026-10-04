import { createHmac, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { forbidden, unauthorized } from './errors.js'

export interface AuthUser {
  id: string
  role: 'patient' | 'doctor'
}

/* ---------- passwords: scrypt with per-user salt ---------- */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(pw, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const calc = scryptSync(pw, Buffer.from(salt, 'hex'), 64)
  const want = Buffer.from(hash, 'hex')
  return calc.length === want.length && timingSafeEqual(calc, want)
}

/* ---------- tiny HS256 JWT ---------- */
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
export function signToken(u: AuthUser, secret: string, ttlSec = 60 * 60 * 24 * 7): string {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify({ sub: u.id, role: u.role, exp: Math.floor(Date.now() / 1000) + ttlSec }))
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}
export function verifyToken(token: string, secret: string): AuthUser | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, b, s] = parts
  const want = createHmac('sha256', secret).update(`${h}.${b}`).digest()
  const got = Buffer.from(s, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString()) as { sub: string; role: AuthUser['role']; exp: number }
    if (p.exp < Date.now() / 1000) return null
    return { id: p.sub, role: p.role }
  } catch {
    return null
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/* ---------- express middleware ---------- */
export function authenticate(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization
    if (h?.startsWith('Bearer ')) {
      const u = verifyToken(h.slice(7), secret)
      if (u) res.locals.user = u
    }
    next()
  }
}
export const requireAuth = (_req: Request, res: Response, next: NextFunction) => {
  if (!res.locals.user) throw unauthorized()
  next()
}
export const requireRole = (role: AuthUser['role']) => (_req: Request, res: Response, next: NextFunction) => {
  if (!res.locals.user) throw unauthorized()
  if ((res.locals.user as AuthUser).role !== role) throw forbidden(`Requires ${role} account`)
  next()
}
export const me = (res: Response) => res.locals.user as AuthUser
