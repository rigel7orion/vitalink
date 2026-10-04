export type AgeGroup = 'infant' | 'child' | 'adult' | 'senior'

export interface Reading {
  hr: number
  tempC: number
  fall: boolean
}

export interface Finding {
  kind: 'tachycardia' | 'bradycardia' | 'fever' | 'hypothermia' | 'fall' | 'hr_spike'
  severity: 'warning' | 'critical'
  message: string
}

/** Resting heart-rate ranges in bpm, by age group. */
export const HR_RANGE: Record<AgeGroup, [number, number]> = {
  infant: [100, 160],
  child: [70, 120],
  adult: [50, 110],
  senior: [50, 100],
}

/**
 * Pure threshold + change detection. Runs on the server so every device is judged the same way
 * (the band can also run the same rules on-device and just post the result).
 * `recentHr` is the patient's previous readings, oldest first.
 */
export function evaluate(r: Reading, age: AgeGroup, recentHr: number[]): Finding[] {
  const out: Finding[] = []
  const [lo, hi] = HR_RANGE[age]

  if (r.fall) out.push({ kind: 'fall', severity: 'critical', message: 'Fall or sudden impact detected' })

  if (r.hr > hi) {
    out.push({
      kind: 'tachycardia',
      severity: r.hr > hi * 1.25 ? 'critical' : 'warning',
      message: `Heart rate ${Math.round(r.hr)} bpm is above the ${age} range (${lo}-${hi})`,
    })
  } else if (r.hr < lo) {
    out.push({
      kind: 'bradycardia',
      severity: r.hr < lo * 0.8 ? 'critical' : 'warning',
      message: `Heart rate ${Math.round(r.hr)} bpm is below the ${age} range (${lo}-${hi})`,
    })
  }

  if (r.tempC >= 38) {
    out.push({
      kind: 'fever',
      // fever in an infant is always treated as critical
      severity: r.tempC >= 39.5 || age === 'infant' ? 'critical' : 'warning',
      message: `Temperature ${r.tempC.toFixed(1)}°C indicates fever`,
    })
  } else if (r.tempC <= 35) {
    out.push({
      kind: 'hypothermia',
      severity: r.tempC <= 34 ? 'critical' : 'warning',
      message: `Temperature ${r.tempC.toFixed(1)}°C is dangerously low`,
    })
  }

  // sudden jump even when still inside the normal range
  const last = recentHr.slice(-10)
  if (last.length >= 3 && !out.some((f) => f.kind === 'tachycardia' || f.kind === 'bradycardia')) {
    const avg = last.reduce((a, b) => a + b, 0) / last.length
    if (Math.abs(r.hr - avg) > 40) {
      out.push({
        kind: 'hr_spike',
        severity: 'warning',
        message: `Heart rate changed suddenly from about ${Math.round(avg)} to ${Math.round(r.hr)} bpm`,
      })
    }
  }
  return out
}
