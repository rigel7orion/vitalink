import { useEffect, useState, type ReactNode } from 'react'
import { useInView } from '../lib/useInView'
import { useVitals, vitals } from '../lib/vitals'

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.15)
  return (
    <div ref={ref} className={`reveal ${seen ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

const Eyebrow = ({ children }: { children: ReactNode }) => <p className="eyebrow">{children}</p>

/* ------------------------------------------------------------------ HERO */
export function Hero() {
  return (
    <section id="hero" className="section hero">
      <div className="col">
        <p className="kicker">hospital</p>
        <h1>
          APPOINTMENT
          <br />
          SYSTEM
        </h1>
        <p className="feat">
          Feat- <strong>VITALINK</strong>
        </p>
        <p className="lede">One platform. Zero delay. Care that doesn&rsquo;t stop at discharge.</p>
        <div className="row">
          <a className="btn btn-solid" href="#platform">
            Explore the platform
          </a>
          <a className="btn btn-ghost" href="#vitalband">
            Meet VitalBand <span aria-hidden="true">↓</span>
          </a>
        </div>
      </div>
      <p className="tagline glass">Book. Monitor. Alert.</p>
    </section>
  )
}

/* --------------------------------------------------------------- PROBLEM */
export function Problem() {
  return (
    <section id="problem" className="section">
      <div className="col wide">
        <Eyebrow>01 · THE PROBLEM</Eyebrow>
        <h2>Healthcare waits. Patients pay.</h2>
        <Reveal className="glass big-quote">
          Every hospital treats you the moment you walk in. None of them treat you the moment something goes wrong.
        </Reveal>
        <div className="grid two">
          <Reveal className="glass soft card" delay={80}>
            <p className="label">PROBLEM IDENTIFICATION</p>
            <h3>The Invisible Wait</h3>
            <p className="muted">Zero visibility: patients don&rsquo;t know doctor availability, queue length, or open slots.</p>
          </Reveal>
          <Reveal className="glass soft card" delay={160}>
            <ul className="questions">
              <li>Is the doctor available?</li>
              <li>Is there a slot?</li>
              <li>Has the appointment been cancelled?</li>
              <li>How long will they wait?</li>
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------- PLATFORM */
const FEATURES = [
  ['Instant e-appointments', 'Kills queues, works for every age group in minutes'],
  ['Unified patient history', 'Doctor sees full background before the patient says a word'],
  ['E-prescriptions', 'Zero paper, zero misreading, straight to the phone'],
  ['Medicine delivery', 'Prescribed + OTC medicine delivered in minutes'],
  ['AI symptom pre-check', 'Fever, redness, itching assessed pre-visit, guides urgency'],
  ['One-tap cancellation', 'No calls, no waiting, no wasted slots'],
] as const

export function Platform() {
  return (
    <section id="platform" className="section">
      <div className="col wide">
        <Eyebrow>02 · VITALINK CORE PLATFORM (BUILT)</Eyebrow>
        <h2>One platform. Zero delay.</h2>
        <div className="grid three">
          {FEATURES.map(([t, d], i) => (
            <Reveal key={t} className="glass soft card feature" delay={i * 70}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <h3>{t}</h3>
              <p className="muted">{d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- INTENT */
const SENTENCE = 'I need a dermatologist tomorrow evening, preferably near me, and I do not want to wait too long.'
const FIELDS = [
  ['Specialty', 'Dermatology'],
  ['Date', 'Tomorrow'],
  ['Time preference', 'Evening'],
  ['Location', 'Nearby'],
  ['Priority', 'Low waiting time'],
] as const
const CAPS = ['Natural-language understanding', 'Intent extraction', 'Structured output', 'Human confirmation']

function IntentDemo() {
  const [ref, seen] = useInView<HTMLDivElement>(0.3)
  const [run, setRun] = useState(0)
  const [typed, setTyped] = useState(0)
  const [shown, setShown] = useState(0)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (!seen) return
    let n = 0
    let k = 0
    let reveal: ReturnType<typeof setInterval> | undefined
    const type = setInterval(() => {
      n += 1
      setTyped(n)
      if (n >= SENTENCE.length) {
        clearInterval(type)
        reveal = setInterval(() => {
          k += 1
          setShown(k)
          if (k >= FIELDS.length) clearInterval(reveal)
        }, 380)
      }
    }, 26)
    return () => {
      clearInterval(type)
      if (reveal) clearInterval(reveal)
    }
  }, [seen, run])

  const replay = () => {
    setTyped(0)
    setShown(0)
    setConfirmed(false)
    setRun((r) => r + 1)
  }
  const ready = shown >= FIELDS.length

  return (
    <div ref={ref} className="demo">
      <div className="glass says">
        <p className="label">PATIENT SAYS</p>
        <p className="speech" aria-live="polite">
          &ldquo;{SENTENCE.slice(0, typed)}
          <span className="caret" aria-hidden="true" />
          &rdquo;
        </p>
      </div>
      <p className="arrow" aria-hidden="true">
        ↓
      </p>
      <div className="glass soft extracted">
        <p className="label">INTENT EXTRACTED</p>
        <dl>
          {FIELDS.map(([k, v], i) => (
            <div key={k} className={`field ${i < shown ? 'on' : ''}`}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="row">
          <button className="btn btn-solid" disabled={!ready || confirmed} onClick={() => setConfirmed(true)}>
            {confirmed ? 'Confirmed ✓' : 'Confirm booking'}
          </button>
          <button className="btn btn-ghost" onClick={replay}>
            Replay
          </button>
        </div>
        <p className="muted small" aria-live="polite">
          {confirmed
            ? 'Done. The patient confirmed, so the booking was made. (Demo: nothing is actually booked.)'
            : ready
              ? 'Booking prepared. Nothing is booked until the patient confirms.'
              : 'Listening…'}
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

export function Intent() {
  return (
    <section id="intent" className="section">
      <div className="col wide">
        <Eyebrow>03 · CITYCARE AI · INTENT BOOKING</Eyebrow>
        <h2 className="quote">
          &ldquo;Say it. CITYCARE AI understands it, finds the right options, and prepares the booking for your confirmation.&rdquo;
        </h2>
        <IntentDemo />
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- VITALBAND */
const BAND = [
  ['Continuous vitals, 24×7', 'Heart rate, body temperature, fall and motion detection'],
  ['Real-time anomaly detection', 'No manual trigger needed, can run on-device'],
  ['Instant auto-alert', 'Nearest available doctor + family, the second a reading turns abnormal'],
  ['Synced with VITALINK history', 'Doctor treats a known patient with a known past'],
] as const

export function VitalBand() {
  const { anomaly } = useVitals()
  return (
    <section id="vitalband" className="section right">
      <div className="col wide">
        <Eyebrow>04 · THE DIFFERENTIATOR</Eyebrow>
        <h2>VitalBand: care after discharge</h2>
        <ul className="glass band-list">
          {BAND.map(([t, d], i) => (
            <li key={t} className={anomaly && i >= 2 ? 'hot' : ''}>
              <span className="dot" aria-hidden="true" />
              <div>
                <h3>{t}</h3>
                <p className="muted">{d}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="row band-controls">
          <button
            className={`btn ${anomaly ? 'btn-alert' : 'btn-solid'}`}
            aria-pressed={anomaly}
            onClick={() => vitals.set({ anomaly: !anomaly })}
          >
            {anomaly ? 'Reset to normal' : 'Simulate an anomaly'}
          </button>
          <p className="muted small" aria-live="polite">
            {anomaly
              ? 'Threshold breached → alert dispatched to nearest doctor + family.'
              : 'Watch the band on the left. Resting: 72 BPM · 36.6°C.'}
          </p>
        </div>
        <p className="foot-note">
          Built for the two groups a hospital never sees once they leave: infants and senior citizens.
        </p>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- STACK */
const STACK = [
  ['Backend / System Core', 'Java (Spring Boot): records, appointment engine, prescriptions'],
  ['AI / ML Layer', 'Python: symptom triage, vitals anomaly detection'],
  ['Wearable Integration', 'BLE band → mobile gateway → alert dispatch'],
  ['Alert Pipeline', 'Real-time push to doctor + family on threshold breach'],
] as const
const WINS = [
  ['Closes the loop', 'Care doesn’t stop at discharge'],
  ['Protects the unprotected', 'Infants and elderly: highest risk, lowest voice'],
  ['On-device AI ready', 'Local anomaly detection for speed + privacy'],
  ['Deployable, not a concept', 'Every module scoped as an engineerable system'],
] as const

export function Stack() {
  return (
    <section id="stack" className="section">
      <div className="col wide">
        <Eyebrow>05 · TECH STACK &amp; WHY WE WIN</Eyebrow>
        <h2>Built to ship. Built to win.</h2>
        <div className="grid two stack-grid">
          <div>
            <p className="label dark">THE STACK</p>
            {STACK.map(([t, d], i) => (
              <Reveal key={t} className="glass soft card layer" delay={i * 70}>
                <span className="swatch" data-i={i} />
                <div>
                  <h3>{t}</h3>
                  <p className="muted">{d}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <div>
            <p className="label dark">WHY THIS WINS</p>
            <Reveal className="glass card wins">
              {WINS.map(([t, d]) => (
                <div key={t}>
                  <h3>{t}</h3>
                  <p className="muted">{d}</p>
                </div>
              ))}
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ DATA */
const DEPTS = [
  ['General Medicine', 122],
  ['Overall', 98.6],
  ['Pediatrics', 43],
] as const

export function Data() {
  const [ref, seen] = useInView<HTMLDivElement>(0.3)
  return (
    <section id="data" className="section">
      <div className="col wide" ref={ref}>
        <Eyebrow>06 · EXPERIMENTAL DATA</Eyebrow>
        <h2>The invisible wait is real.</h2>
        <div className="stats">
          <div className="glass stat wait">
            <strong>98.6</strong>
            <span>min average waiting time</span>
          </div>
          <div className="glass stat talk">
            <strong>6.5</strong>
            <span>min average consultation time</span>
          </div>
        </div>
        <p className="muted source">Kolkata tertiary-care hospital study, n=432. Patients wait about 15× longer than they spend with the doctor.</p>
        <div className="glass soft card">
          <p className="label dark">KOLKATA OPD · MEAN WAITING TIME BY DEPARTMENT (MIN)</p>
          {DEPTS.map(([name, v]) => (
            <div className="bar-row" key={name}>
              <span>{name}</span>
              <div className="track">
                <div className="fill" style={{ width: seen ? `${(v / 122) * 100}%` : '0%' }} />
              </div>
              <b>{v} min</b>
            </div>
          ))}
        </div>
        <p className="muted small source">
          Also reported: Aravind Eye Hospital (Madurai) combined approach cut cycle time 19% vs baseline; India&rsquo;s Scan &amp; Share
          cut registration wait to 2–5 min (WHO Bulletin report).
        </p>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------- CLOSING */
export function Closing() {
  return (
    <section id="closing" className="section closing">
      <div className="col">
        <h2 className="finale">
          It watches.
          <br />
          It warns.
          <br />
          It acts.
        </h2>
        <p className="lede italic">VITALINK doesn&rsquo;t wait for the patient.</p>
        <div className="row">
          <a className="btn btn-solid" href="#intent">
            Book an appointment
          </a>
          <a className="btn btn-ghost" href="#hero">
            Back to top <span aria-hidden="true">↑</span>
          </a>
        </div>
        <p className="end">END</p>
      </div>
    </section>
  )
}
