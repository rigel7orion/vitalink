import type { ReactNode } from 'react'
import { useInView } from '../lib/useInView'
import { useVitals } from '../lib/vitals'
import { BandLive, IntentLive } from './live'
import { BandWatch } from './BandWatch'

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
          <a className="btn btn-ghost" href="/band">
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
export function Intent({ live = false }: { live?: boolean }) {
  return (
    <section id="intent" className="section">
      <div className="col wide">
        <Eyebrow>03 · CITYCARE AI · INTENT BOOKING</Eyebrow>
        <h2 className="quote">
          &ldquo;Say it. CITYCARE AI understands it, finds the right options, and prepares the booking for your confirmation.&rdquo;
        </h2>
        {live ? (
          <IntentLive />
        ) : (
          <div className="row">
            <a className="btn btn-solid" href="/book">
              Book an appointment
            </a>
            <a className="btn btn-ghost" href="/bills">
              My bills
            </a>
          </div>
        )}
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

export function VitalBand({ live = false }: { live?: boolean }) {
  const { anomaly } = useVitals()
  return (
    <section id="vitalband" className="section right">
      <BandWatch />
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
        {live ? (
          <BandLive />
        ) : (
          <div className="row">
            <a className="btn btn-solid" href="/band">
              Try VitalBand live
            </a>
          </div>
        )}
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
          <a className="btn btn-solid" href="/book">
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
