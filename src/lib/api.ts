import { useSyncExternalStore } from 'react'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
  ) {
    super(message)
  }
}

export interface User {
  id: string
  name: string
  email: string
  role: 'patient' | 'doctor'
  ageGroup: string
}

/* ---------- session (token + user), persisted when storage is available ---------- */
interface Session {
  token: string
  user: User
}
const KEY = 'vitalink.session'
const read = (): Session | null => {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}
let session: Session | null = read()
const subs = new Set<() => void>()
export const auth = {
  get: () => session,
  subscribe(fn: () => void) {
    subs.add(fn)
    return () => subs.delete(fn)
  },
  set(s: Session | null) {
    session = s
    try {
      if (s) localStorage.setItem(KEY, JSON.stringify(s))
      else localStorage.removeItem(KEY)
    } catch {
      /* storage unavailable: session lives in memory only */
    }
    subs.forEach((f) => f())
  },
}
export const useSession = () => useSyncExternalStore(auth.subscribe, auth.get)

/* ---------- fetch wrapper ---------- */
export async function api<T>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(session ? { authorization: `Bearer ${session.token}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Start it with "npm run dev:all".', 'offline')
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && session) auth.set(null) // expired session
    const detail = data?.details?.[0]?.message
    throw new ApiError(res.status, (data?.error ?? 'Request failed') + (detail ? `: ${detail}` : ''), data?.code)
  }
  return data as T
}

export async function signIn(email: string, password: string) {
  const r = await api<Session>('/auth/login', { body: { email, password } })
  auth.set(r)
}
export async function signUp(name: string, email: string, password: string) {
  const r = await api<Session>('/auth/register', { body: { name, email, password, lat: 22.5726, lng: 88.3639 } })
  auth.set(r)
}
export const signOut = () => auth.set(null)

/* ---------- shared types ---------- */
export interface Option {
  doctor: { id: string; name: string; specialty: string; room: string; fee: number }
  start: string
  end: string
  distanceKm: number | null
  estimatedWaitMin: number
  why: string[]
}
export interface IntentResult {
  parsed: {
    specialty: string | null
    date: string | null
    timePreference: { label: string } | null
    location: 'nearby' | null
    priority: 'low_waiting_time' | null
  }
  missing: string[]
  options: Option[]
}
export interface InvoiceLine {
  description: string
  qty: number
  unitPaise: number
  amountPaise: number
  taxPct: number
  taxPaise: number
}
export type PayMethod = 'upi' | 'card' | 'netbanking' | 'pay_at_clinic'
export interface Invoice {
  id: string
  invoiceNo: string
  appointmentId: string
  status: 'pending' | 'paid' | 'refunded' | 'void'
  lines: InvoiceLine[]
  subtotalPaise: number
  taxPaise: number
  totalPaise: number
  billedTo: { name: string; email: string }
  issuedAt: string
  payment: { method: PayMethod; ref: string | null; paidAt: string | null } | null
  refund: { amountPaise: number; creditNoteNo: string; at: string | null } | null
  pdfUrl: string
}
export interface Appointment {
  id: string
  bookingId: string
  token: string
  status: string
  start: string
  doctor: { name: string; specialty: string; room: string }
  invoice?: Invoice
}
export interface AlertView {
  id: string
  kind: string
  severity: 'warning' | 'critical'
  message: string
  status: string
  doctor: { id: string; name: string | null } | null
  notified: { type: string; name: string; channel: string }[]
}

export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/* ---------- billing helpers ---------- */
const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })
/** Money is integer paise everywhere; this is the only place it becomes a display string. */
export const inr = (paise: number) => inrFmt.format(paise / 100)

export const payInvoice = (id: string, method: PayMethod) => api<Invoice>(`/invoices/${id}/pay`, { body: { method } })

/** The PDF endpoint needs the bearer token, so fetch it as a blob and save it from memory. */
export async function downloadInvoicePdf(inv: Invoice) {
  const res = await fetch(inv.pdfUrl, { headers: session ? { authorization: `Bearer ${session.token}` } : {} })
  if (!res.ok) throw new ApiError(res.status, 'Could not download the invoice. Please try again.')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = `VITALINK-${inv.invoiceNo.replace(/\//g, '-')}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export interface ShareResult {
  url: string
  expiresAt: string
  whatsappUrl: string
}
export const shareInvoice = (id: string) => api<ShareResult>(`/invoices/${id}/share`, { body: {} })
export const emailInvoiceToMe = (id: string) => api<{ status: 'sent' | 'logged' | 'failed'; to: string; configured: boolean }>(`/invoices/${id}/email`, { body: {} })

export interface DoctorDashboard {
  doctor: { id: string; specialty: string; room: string }
  today: {
    total: number
    booked: number
    completed: number
    appointments: { id: string; bookingId: string; token: string; start: string; status: string; reason: string; patient: string }[]
  }
  patients: { total: number; recent: { id: string; name: string; visits: number; lastVisit: string }[] }
  earnings: { paidPaise: number; pendingPaise: number; refundedPaise: number; last7Days: { date: string; paise: number }[] }
  recentBills: { id: string; invoiceNo: string; patient: string; status: Invoice['status']; totalPaise: number; doctorSharePaise: number; issuedAt: string }[]
}
export const getDoctorDashboard = () => api<DoctorDashboard>('/doctor/dashboard')
