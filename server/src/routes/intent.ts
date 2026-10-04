import { Router } from 'express'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { me } from '../auth.js'
import { clinicDate } from '../time.js'
import { parseIntent, suggestOptions } from '../services/intent.js'
import { triage } from '../services/triage.js'

const IntentBody = z.object({
  text: z.string().trim().min(3).max(500),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})
const TriageBody = z
  .object({
    text: z.string().trim().max(1000).optional(),
    symptoms: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    ageGroup: z.enum(['infant', 'child', 'adult', 'senior']).optional(),
  })
  .refine((b) => (b.text && b.text.length > 0) || (b.symptoms && b.symptoms.length > 0), {
    message: 'Provide text or symptoms',
  })

export function intentRoutes({ db, cfg, now }: Ctx) {
  const r = Router()

  /**
   * CITYCARE AI intent booking: natural language in, structured intent + real bookable options out.
   * This never books anything. The patient confirms by calling POST /api/appointments.
   */
  r.post('/intent/parse', (req, res) => {
    const b = IntentBody.parse(req.body)
    const t = now()
    const parsed = parseIntent(b.text, clinicDate(t, cfg.clinicOffsetMin))

    let lat = b.lat
    let lng = b.lng
    if ((lat == null || lng == null) && res.locals.user) {
      const u = db.prepare('SELECT lat, lng FROM users WHERE id = ?').get(me(res).id) as { lat: number | null; lng: number | null } | undefined
      if (u?.lat != null && u.lng != null) {
        lat = u.lat
        lng = u.lng
      }
    }

    const missing: string[] = []
    if (!parsed.specialty) missing.push('specialty')
    if (!parsed.date) missing.push('date')
    if (!parsed.timePreference) missing.push('timePreference')
    if (parsed.location === 'nearby' && (lat == null || lng == null)) missing.push('coordinates')

    res.json({
      text: b.text,
      parsed,
      missing,
      options: suggestOptions(db, cfg, parsed, { lat, lng }, t),
      requiresConfirmation: true,
      note: 'Nothing is booked yet. Confirm one option with POST /api/appointments.',
    })
  })

  r.post('/triage', (req, res) => {
    const b = TriageBody.parse(req.body)
    let ageGroup = b.ageGroup
    if (!ageGroup && res.locals.user) {
      const u = db.prepare('SELECT age_group FROM users WHERE id = ?').get(me(res).id) as { age_group: 'infant' | 'child' | 'adult' | 'senior' } | undefined
      ageGroup = u?.age_group
    }
    res.json(triage({ text: b.text, symptoms: b.symptoms, ageGroup }))
  })

  return r
}
