import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import {
  api,
  ApiError,
  auth,
  fmtWhen,
  signIn,
  signUp,
  useSession,
  type AlertView,
  type Appointment,
  inr,
  type IntentResult,
} from '../lib/api'
import { useInView } from '../lib/useInView'
import { useVitals, vitals } from '../lib/vitals'
import { Bill } from './Bill'

/* =================================================================== sign-in dialog */
const dlg = { open: false, after: undefined as (() => void) | undefined }
const dlgSubs = new Set<() => void>()
const setDlg = (open: boolean, after?: () => void) => {
  dlg.open = open
  dlg.after = after
  dlgSubs.forEach((f) => f())
}
export const openAuth = (after?: () => void) => setDlg(true, after)
const useDlgOpen = () =>
  useSyncExternalStore(
    (f) => (dlgSubs.add(f), () => dlgSubs.delete(f)),
    () => dlg.open,
  )

export function AuthDialog() {
  const open = useDlgOpen()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDlg(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, mode])

  if (!open) return null

  const finish = () => {
    const after = dlg.after
    setDlg(false)
    setErr('')
    after?.()
  }
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setErr('')
    try {
      const email = String(f.get('email'))
      const password = String(f.get('password'))
      if (mode === 'up') await signUp(String(f.get('name')), email, password)
      else await signIn(email, password)
      finish()
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  const demo = async () => {
    setBusy(true)
    try {
      await signIn('demo@vitalink.test', 'demo1234')
      finish()
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" data-lenis-prevent onMouseDown={(e) => e.target === e.currentTarget && setDlg(false)}>
      <form className="glass dialog" role="dialog" aria-modal="true" aria-label={mode === 'in' ? 'Sign in' : 'Create account'} onSubmit={submit}>
        <h3>{mode === 'in' ? 'Sign in to VITALINK' : 'Create your account'}</h3>
        {mode === 'up' && (
          <label>
            Name
            <input ref={first} name="name" required minLength={2} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input ref={mode === 'in' ? first : undefined} name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input name="password" type="password" required minLength={mode === 'up' ? 8 : 1} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />
        </label>
        {mode === 'up' && <p className="muted small">At least 8 characters.</p>}
        {err && (
          <p className="error" role="alert">
            {err}
          </p>
        )}
        <div className="row tight">
          <button className="btn btn-solid" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setDlg(false)}>
            Cancel
          </button>
        </div>
        <p className="muted small">
          {mode === 'in' ? 'New here? ' : 'Already have an account? '}
          <button type="button" className="link" onClick={() => (setMode(mode === 'in' ? 'up' : 'in'), setErr(''))}>
            {mode === 'in' ? 'Create an account' : 'Sign in'}
          </button>
          {import.meta.env.DEV && (
            <>
              {' · '}
              <button type="button" className="link" onClick={demo}>
                Use the dev demo patient
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  )
}

/* =================================================================== CITYCARE AI */
const SENTENCE = 'I need a dermatologist tomorrow evening, preferably near me, and I do not want to wait too long.'
const CAPS = ['Natural-language understanding', 'Intent extraction', 'Structured output', 'Human confirmation']
// The demo uses a fixed central-Kolkata position; a real app would ask the browser for geolocation.
const DEMO_POS = { lat: 22.5726, lng: 88.3639 }

const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '—'

export function IntentLive() {
  const session = useSession()
  const [ref, seen] = useInView<HTMLDivElement>(0.3)
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<IntentResult | null>(null)
  const [pick, setPick] = useState(0)
  const [booked, setBooked] = useState<Appointment | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  const parse = async (t: string, note = '') => {
    setLoading(true)
    setMsg(note)
    setBooked(null)
    try {
      const r = await api<IntentResult>('/intent/parse', { body: { text: t, ...DEMO_POS } })
      setResult(r)
      setPick(0)
    } catch (e) {
      setResult(null)
      setMsg(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // type the deck's example sentence once, then let the backend understand it
  useEffect(() => {
    if (!seen || started.current) return
    started.current = true
    setTyping(true)
    let n = 0
    const id = setInterval(() => {
      n += 1
      setText(SENTENCE.slice(0, n))
      if (n >= SENTENCE.length) {
        clearInterval(id)
        setTyping(false)
        void parse(SENTENCE)
      }
    }, 24)
    return () => clearInterval(id)
  }, [seen])

  const book = async () => {
    const o = result?.options[pick]
    if (!o) return
    setBusy(true)
    setMsg('')
    try {
      const a = await api<Appointment>('/appointments', { body: { doctorId: o.doctor.id, start: o.start, reason: text.slice(0, 200) } })
      setBooked(a)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'slot_taken') {
        void parse(text, 'That slot was just taken. Showing fresh options.')
      } else setMsg(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  const confirm = () => {
    if (!auth.get()) return openAuth(() => void book())
    if (auth.get()!.user.role !== 'patient') return setMsg('Sign in with a patient account to book.')
    void book()
  }
  const cancel = async () => {
    if (!booked) return
    setBusy(true)
    try {
      const c = await api<Appointment>(`/appointments/${booked.id}`, { method: 'DELETE' })
      const refund = c.invoice?.refund
      void parse(
        text,
        refund
          ? `Appointment cancelled. ${inr(refund.amountPaise)} refunded (credit note ${refund.creditNoteNo}). The slot is free again.`
          : 'Appointment cancelled. Nothing was charged and the slot is free again.',
      )
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const p = result?.parsed
  const rows: [string, string][] = [
    ['Specialty', p?.specialty ?? '—'],
    ['Date', fmtDate(p?.date ?? null)],
    ['Time preference', p?.timePreference?.label ?? '—'],
    ['Location', p?.location ? 'Nearby' : '—'],
    ['Priority', p?.priority ? 'Low waiting time' : '—'],
  ]

  return (
    <div ref={ref} className="demo">
      <div className="glass says">
        <p className="label">PATIENT SAYS</p>
        <textarea
          className="speech-input"
          aria-label="Describe the appointment you need"
          value={text}
          readOnly={typing}
          rows={3}
          maxLength={500}
          placeholder="e.g. I need a pediatrician next Monday morning"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row tight">
          <button className="btn btn-ghost" disabled={typing || loading || text.trim().length < 3} onClick={() => void parse(text)}>
            {loading ? 'Understanding…' : 'Understand'}
          </button>
        </div>
      </div>
      <p className="arrow" aria-hidden="true">
        ↓
      </p>
      <div className="glass soft extracted">
        <p className="label">INTENT EXTRACTED</p>
        <dl>
          {rows.map(([k, v]) => (
            <div key={k} className={`field ${result ? 'on' : ''}`}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {result && result.missing.length > 0 && !result.missing.every((m) => m === 'coordinates') && (
          <p className="muted small">Not detected: {result.missing.filter((m) => m !== 'coordinates').join(', ')}. Add it to the sentence to narrow the options.</p>
        )}

        {result && (
          <fieldset className="opts" disabled={!!booked}>
            <legend className="label">{result.options.length ? 'BEST AVAILABLE SLOTS' : 'NO SLOTS FOUND'}</legend>
            {result.options.map((o, i) => (
              <label key={o.doctor.id + o.start} className={`opt ${pick === i ? 'sel' : ''}`}>
                <input type="radio" name="slot" checked={pick === i} onChange={() => setPick(i)} />
                <span>
                  <b>{o.doctor.name}</b> · {o.doctor.specialty}
                  <small>
                    {fmtWhen(o.start)} · {o.doctor.room}
                    {o.why.length ? ` · ${o.why.join(' · ')}` : ''}
                  </small>
                </span>
              </label>
            ))}
            {!result.options.length && <p className="muted small">Try a different day or time, or another specialty.</p>}
          </fieldset>
        )}

        {booked ? (
          <div className="booked" role="status">
            <b>Booked ✓</b> {booked.bookingId} · Token {booked.token}
            <br />
            {booked.doctor.name}, {booked.doctor.room} · {fmtWhen(booked.start)}
            {booked.invoice && <Bill invoice={booked.invoice} onChange={(invoice) => setBooked((b) => (b ? { ...b, invoice } : b))} />}
            <div className="row tight">
              <button className="btn btn-ghost" disabled={busy} onClick={cancel}>
                Cancel appointment
              </button>
            </div>
          </div>
        ) : (
          <div className="row tight">
            <button className="btn btn-solid" disabled={!result?.options.length || busy} onClick={confirm}>
              {busy ? 'Booking…' : session ? 'Confirm booking' : 'Sign in to confirm'}
            </button>
          </div>
        )}
        <p className="muted small" aria-live="polite">
          {msg || (booked ? 'Confirmed by the patient, so the booking was made.' : result ? 'Nothing is booked until the patient confirms.' : loading ? 'Listening…' : '')}
        </p>
      </div>
      <ul className="chips">
        {CAPS.map((c) => (
          <li key={c} className="glass soft chip">
            {c}
          </li>
        ))}
      </ul>
    </div>
  )
}


/* =================================================================== VitalBand */
interface Contact {
  id: string
  name: string
  phone: string
}

const bandKey = (uid: string) => `vitalink.band.${uid}`
const readKey = (uid: string) => {
  try {
    return localStorage.getItem(bandKey(uid))
  } catch {
    return null
  }
}
const saveKey = (uid: string, k: string) => {
  try {
    localStorage.setItem(bandKey(uid), k)
  } catch {
    /* in-memory only */
  }
}

async function ensureDevice(uid: string, force = false): Promise<string> {
  const existing = force ? null : readKey(uid)
  if (existing) return existing
  const d = await api<{ key: string }>('/devices', { body: { label: 'VitalBand (web demo)' } })
  saveKey(uid, d.key)
  return d.key
}
async function postReading(uid: string, body: { hr: number; tempC: number; fall?: boolean }) {
  const send = async (key: string) =>
    api<{ anomalous: boolean; alerts: AlertView[] }>('/vitals', { body, headers: { 'x-device-key': key } })
  try {
    return await send(await ensureDevice(uid))
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return send(await ensureDevice(uid, true)) // key was revoked
    throw e
  }
}

export function BandLive() {
  const session = useSession()
  const { anomaly } = useVitals()
  const [busy, setBusy] = useState(false)
  const [alerts, setAlerts] = useState<AlertView[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [msg, setMsg] = useState('')
  const [ack, setAck] = useState('')

  const isPatient = session?.user.role === 'patient'
  const token = session?.token

  useEffect(() => {
    if (!isPatient) {
      setContacts([])
      return
    }
    api<Contact[]>('/family')
      .then(setContacts)
      .catch(() => setContacts([]))
  }, [isPatient, token])

  // live updates: a doctor acknowledging the alert shows up here without refreshing
  useEffect(() => {
    if (!token || !isPatient) return
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`)
    es.addEventListener('alert_ack', (e) => {
      const a = JSON.parse((e as MessageEvent<string>).data) as AlertView
      setAlerts((cur) => cur.map((x) => (x.id === a.id ? a : x)))
      setAck(`${a.doctor?.name ?? 'A doctor'} acknowledged the alert.`)
    })
    return () => es.close()
  }, [token, isPatient])

  const guard = (fn: () => Promise<void>) => async () => {
    const s = auth.get()
    if (!s) return openAuth(() => void guard(fn)())
    if (s.user.role !== 'patient') return setMsg('Sign in with a patient account to use the band.')
    setBusy(true)
    setMsg('')
    setAck('')
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const simulate = guard(async () => {
    const uid = auth.get()!.user.id
    await postReading(uid, { hr: 72, tempC: 36.6 })
    const r = await postReading(uid, { hr: 148, tempC: 38.9 })
    vitals.set({ anomaly: true })
    if (r.alerts.length) setAlerts((cur) => [...r.alerts, ...cur])
    else {
      const open = await api<AlertView[]>('/alerts?status=open')
      setAlerts(open)
      setMsg('An alert for this was already sent in the last 5 minutes, so no duplicate was created.')
    }
  })
  const reset = guard(async () => {
    vitals.set({ anomaly: false })
    await postReading(auth.get()!.user.id, { hr: 72, tempC: 36.6 })
  })

  const addContact = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    try {
      const c = await api<Contact>('/family', { body: { name: String(f.get('name')), phone: String(f.get('phone')), relation: 'family' } })
      setContacts((cur) => [...cur, c])
      form.reset()
      setMsg('')
    } catch (x) {
      setMsg(x instanceof ApiError ? x.message : 'Something went wrong')
    }
  }

  return (
    <div className="band-live">
      <div className="row band-controls">
        <button className={`btn ${anomaly ? 'btn-alert' : 'btn-solid'}`} aria-pressed={anomaly} disabled={busy} onClick={anomaly ? reset : simulate}>
          {busy ? 'Sending…' : anomaly ? 'Reset to normal' : session ? 'Simulate an anomaly' : 'Sign in to simulate'}
        </button>
        <p className="muted small" aria-live="polite">
          {msg || (anomaly ? 'Threshold breached. The server detected it and alerted the nearest doctor and family.' : 'Watch the band on the left. Resting: 72 BPM · 36.6°C.')}
        </p>
      </div>

      {isPatient && (
        <form className="family" onSubmit={addContact}>
          <span className="label dark">FAMILY ALERT CONTACTS</span>
          <ul>
            {contacts.map((c) => (
              <li key={c.id}>
                {c.name} <small>{c.phone}</small>
              </li>
            ))}
          </ul>
          <div className="row tight">
            <input name="name" placeholder="Name" required minLength={2} aria-label="Contact name" />
            <input name="phone" placeholder="+91 98765 43210" required aria-label="Contact phone" />
            <button className="btn btn-ghost">Add</button>
          </div>
        </form>
      )}

      {alerts.length > 0 && (
        <ul className="alerts" aria-live="polite">
          {alerts.slice(0, 4).map((a) => (
            <li key={a.id} className={`alert ${a.severity}`}>
              <b>{a.severity.toUpperCase()}</b> {a.message}
              <small>
                {a.doctor?.name ? `Assigned to ${a.doctor.name}` : 'No doctor on duty'} · notified:{' '}
                {a.notified.length ? a.notified.map((n) => `${n.name} (${n.type})`).join(', ') : 'nobody'} · {a.status}
              </small>
            </li>
          ))}
        </ul>
      )}
      {ack && <p className="ack">{ack}</p>}
    </div>
  )
}
