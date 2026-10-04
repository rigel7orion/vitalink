import type { DB } from '../db.js'
import type { Config } from '../config.js'
import { addDays, clinicDate, dayOfWeek, isDate } from '../time.js'
import { distanceKm, doctorView, listDoctors, queueFor, slotsFor } from './doctors.js'

/** Specialty vocabulary: explicit names win over symptom words. */
const SPECIALTIES: { name: string; explicit: RegExp; symptoms: RegExp }[] = [
  { name: 'Dermatology', explicit: /\bdermatolog\w*|\bskin (doctor|specialist)\b/i, symptoms: /\b(skin|rash|acne|eczema|itch\w*|redness|hives|psoriasis)\b/i },
  { name: 'Pediatrics', explicit: /\bp(a)?ediatric\w*|\bchild(ren)?'?s? (doctor|specialist)\b/i, symptoms: /\b(baby|infant|toddler|newborn|my (son|daughter|child|kid))\b/i },
  { name: 'Cardiology', explicit: /\bcardiolog\w*|\bheart (doctor|specialist)\b/i, symptoms: /\b(heart|palpitations?|chest pain|blood pressure)\b/i },
  { name: 'Orthopedics', explicit: /\borthop(a)?edic\w*|\bbone (doctor|specialist)\b/i, symptoms: /\b(bone|joint|fracture|knee|shoulder|back pain|sprain)\b/i },
  { name: 'ENT', explicit: /\bent (doctor|specialist)\b|\botolaryngolog\w*|\bear,? nose,? (and )?throat\b/i, symptoms: /\b(ear ?ache|ear|nose|throat|sinus|tonsil\w*)\b/i },
  { name: 'Geriatrics', explicit: /\bgeriatric\w*|\belder(ly)? (care|doctor|specialist)\b/i, symptoms: /\b(elderly|senior citizen|my (grand(mother|father|ma|pa)|parents?))\b/i },
  { name: 'General Medicine', explicit: /\b(general (physician|medicine|doctor)|gp|family doctor|physician)\b/i, symptoms: /\b(fever|cold|cough|flu|headache|stomach|body ache)\b/i },
]

const WHO = new Set(['Pediatrics', 'Geriatrics'])

export function detectSpecialty(text: string): string | null {
  for (const s of SPECIALTIES) if (s.explicit.test(text)) return s.name
  // who the patient is (baby, elderly parent) outranks which body part hurts
  for (const s of SPECIALTIES) if (WHO.has(s.name) && s.symptoms.test(text)) return s.name
  for (const s of SPECIALTIES) if (s.symptoms.test(text)) return s.name
  return null
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function parseDate(text: string, today: string): string | null {
  const t = text.toLowerCase()
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (iso && isDate(iso[1])) return iso[1]
  if (/\bday after tomorrow\b/.test(t)) return addDays(today, 2)
  if (/\btomorrow\b/.test(t)) return addDays(today, 1)
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(t)) return today
  const inN = t.match(/\bin (\d{1,2}) days?\b/)
  if (inN) return addDays(today, Number(inN[1]))
  for (let i = 0; i < 7; i++) {
    const m = t.match(new RegExp(`\\b(next |this |on )?${WEEKDAYS[i]}\\b`))
    if (m) {
      let diff = (i - dayOfWeek(today) + 7) % 7
      if (diff === 0) diff = 7 // a bare weekday name means the next one, not today
      return addDays(today, diff)
    }
  }
  return null
}

export interface TimeWindow {
  label: string
  from: number // hour, inclusive
  to: number // hour, exclusive
}

function parseTime(text: string): TimeWindow | null {
  const t = text.toLowerCase()
  const hour = (h: string, ap?: string) => {
    let n = Number(h)
    if (ap === 'pm' && n < 12) n += 12
    if (ap === 'am' && n === 12) n = 0
    return n
  }
  const after = t.match(/\bafter (\d{1,2})(?::\d{2})? ?(am|pm)?\b/)
  if (after) return { label: `after ${after[1]}${after[2] ? ' ' + after[2] : ''}`, from: hour(after[1], after[2]), to: 24 }
  const before = t.match(/\bbefore (\d{1,2})(?::\d{2})? ?(am|pm)?\b/)
  if (before) return { label: `before ${before[1]}${before[2] ? ' ' + before[2] : ''}`, from: 0, to: hour(before[1], before[2]) }
  const at = t.match(/\b(?:at|around) (\d{1,2})(?::\d{2})? ?(am|pm)\b/) ?? t.match(/\b(\d{1,2}) ?(am|pm)\b/)
  if (at) {
    const h = hour(at[1], at[2])
    return { label: `around ${at[1]} ${at[2]}`, from: Math.max(0, h - 1), to: h + 2 }
  }
  if (/\bmorning\b/.test(t)) return { label: 'Morning', from: 6, to: 12 }
  if (/\bafternoon\b/.test(t)) return { label: 'Afternoon', from: 12, to: 16 }
  if (/\b(evening|tonight)\b/.test(t)) return { label: 'Evening', from: 16, to: 21 }
  if (/\bnight\b/.test(t)) return { label: 'Night', from: 18, to: 24 }
  return null
}

export interface ParsedIntent {
  specialty: string | null
  date: string | null
  timePreference: TimeWindow | null
  location: 'nearby' | null
  priority: 'low_waiting_time' | null
}

export function parseIntent(text: string, today: string): ParsedIntent {
  return {
    specialty: detectSpecialty(text),
    date: parseDate(text, today),
    timePreference: parseTime(text),
    location: /\b(near ?by|near me|close (to|by)|around me|nearest|closest)\b/i.test(text) ? 'nearby' : null,
    priority:
      /\b(don'?t|do not|not|without)\b[^.]*\b(wait|long)\b|\b(low|short|least|minimal|no) wait\w*|\b(quick(ly)?|fast|asap|soonest|earliest)\b/i.test(text)
        ? 'low_waiting_time'
        : null,
  }
}

export interface Option {
  doctor: ReturnType<typeof doctorView>
  start: string
  end: string
  distanceKm: number | null
  estimatedWaitMin: number
  why: string[]
}

/** Rank real, bookable slots for the parsed intent. Nothing is booked here. */
export function suggestOptions(
  db: DB,
  cfg: Config,
  p: ParsedIntent,
  where: { lat?: number | null; lng?: number | null },
  now: number,
  limit = 5,
): Option[] {
  if (!p.specialty) return []
  const today = clinicDate(now, cfg.clinicOffsetMin)
  const dates = p.date ? [p.date] : Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const hasPos = where.lat != null && where.lng != null
  const scored: (Option & { score: number })[] = []

  for (const d of listDoctors(db, p.specialty)) {
    const dist = hasPos ? distanceKm(where.lat!, where.lng!, d.lat, d.lng) : null
    const wait = queueFor(db, cfg, d, now).estimatedWaitMin
    for (const date of dates) {
      for (const s of slotsFor(db, cfg, d, date, now)) {
        if (!s.available) continue
        const hour = new Date(s.start + cfg.clinicOffsetMin * 60_000).getUTCHours()
        if (p.timePreference && (hour < p.timePreference.from || hour >= p.timePreference.to)) continue
        const hoursAway = (s.start - now) / 3_600_000
        let score = hoursAway
        const why: string[] = []
        if (p.timePreference) why.push(`${p.timePreference.label} slot`)
        if (p.location === 'nearby' && dist != null) {
          score += dist * 0.8
          why.push(`${dist.toFixed(1)} km away`)
        }
        if (p.priority === 'low_waiting_time') {
          score += wait / 30
          why.push(wait === 0 ? 'no queue today' : `about ${wait} min queue today`)
        }
        scored.push({
          doctor: doctorView(d),
          start: new Date(s.start).toISOString(),
          end: new Date(s.end).toISOString(),
          distanceKm: dist == null ? null : Math.round(dist * 10) / 10,
          estimatedWaitMin: wait,
          why,
          score,
        })
      }
    }
  }
  scored.sort((a, b) => a.score - b.score || a.start.localeCompare(b.start))
  // at most 2 slots per doctor so the patient sees real alternatives
  const per = new Map<string, number>()
  const out: Option[] = []
  for (const o of scored) {
    const n = per.get(o.doctor.id) ?? 0
    if (n >= 2) continue
    per.set(o.doctor.id, n + 1)
    const { score: _s, ...rest } = o
    out.push(rest)
    if (out.length >= limit) break
  }
  return out
}
