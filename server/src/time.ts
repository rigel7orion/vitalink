// All timestamps are stored as UTC epoch milliseconds. "Clinic time" is a fixed offset.
const DAY = 86_400_000

export const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD of an instant as seen in the clinic timezone. */
export function clinicDate(ms: number, offsetMin: number): string {
  const d = new Date(ms + offsetMin * 60_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function clinicHourMinute(ms: number, offsetMin: number): { h: number; m: number; dow: number } {
  const d = new Date(ms + offsetMin * 60_000)
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), dow: d.getUTCDay() }
}

/** UTC ms for a clinic-local date + time. */
export function clinicToUtc(date: string, h: number, m: number, offsetMin: number): number {
  const [y, mo, d] = date.split(/-/).map(Number)
  return Date.UTC(y, mo - 1, d, h, m) - offsetMin * 60_000
}

export function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split('-').map(Number)
  const t = Date.UTC(y, mo - 1, d) + n * DAY
  const x = new Date(t)
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`
}

export function dayOfWeek(date: string): number {
  const [y, mo, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
}

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
