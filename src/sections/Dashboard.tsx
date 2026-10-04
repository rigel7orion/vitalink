import { useCallback, useEffect, useState } from 'react'
import { openAuth } from './live'
import { ApiError, fmtWhen, getDoctorDashboard, inr, useSession, type DoctorDashboard } from '../lib/api'

const day = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/** Doctor-only: today's queue, patients, earnings and bills. Rendered only for a signed-in doctor. */
export function DoctorDashboardSection() {
  const session = useSession()
  const [d, setD] = useState<DoctorDashboard | null>(null)
  const [err, setErr] = useState('')
  const isDoctor = session?.user.role === 'doctor'

  const load = useCallback(async () => {
    setErr('')
    try {
      setD(await getDoctorDashboard())
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not load the dashboard')
    }
  }, [])
  useEffect(() => {
    if (isDoctor) void load()
    else setD(null)
  }, [isDoctor, load])

  if (!isDoctor)
    return (
      <section className="section" id="data">
        <div className="glass dash">
          <h2>Doctor dashboard</h2>
          <p>Sign in with a doctor account to see your queue, patients and earnings.</p>
          <button className="btn btn-solid" onClick={() => openAuth()}>
            Sign in
          </button>
        </div>
      </section>
    )
  const max = Math.max(1, ...(d?.earnings.last7Days.map((x) => x.paise) ?? [1]))

  return (
    <section className="section" id="data">
      <div className="glass dash">
        <header className="dash-head">
          <h2>Doctor dashboard</h2>
          <button className="btn btn-ghost" onClick={load}>
            Refresh
          </button>
        </header>
        {err && <p className="error" role="alert">{err}</p>}
        {!d && !err && <p className="muted">Loading…</p>}
        {d && (
          <>
            <div className="dash-stats">
              <div><small>Today</small><b>{d.today.total}</b><span>{d.today.booked} waiting · {d.today.completed} done</span></div>
              <div><small>Patients</small><b>{d.patients.total}</b><span>all time</span></div>
              <div><small>Earned</small><b>{inr(d.earnings.paidPaise)}</b><span>{inr(d.earnings.pendingPaise)} pending</span></div>
              <div><small>Refunded</small><b>{inr(d.earnings.refundedPaise)}</b><span>cancelled visits</span></div>
            </div>

            <h3>Last 7 days (consultation fees paid)</h3>
            <div className="dash-bars" role="img" aria-label="Earnings for the last 7 days">
              {d.earnings.last7Days.map((x) => (
                <div key={x.date} title={`${x.date}: ${inr(x.paise)}`}>
                  <i style={{ height: `${Math.max(4, (x.paise / max) * 100)}%` }} />
                  <span>{day(x.date)}</span>
                </div>
              ))}
            </div>

            <div className="dash-cols">
              <div>
                <h3>Today's queue</h3>
                {d.today.appointments.length === 0 ? (
                  <p className="muted small">No appointments today.</p>
                ) : (
                  <ul className="dash-list">
                    {d.today.appointments.map((a) => (
                      <li key={a.id}>
                        <span><b>{a.patient}</b><small>{time(a.start)} · Token {a.token}</small></span>
                        <em className={`pill ${a.status === 'completed' ? 'paid' : a.status === 'cancelled' ? 'refunded' : ''}`}>{a.status}</em>
                      </li>
                    ))}
                  </ul>
                )}
                <h3>Recent patients</h3>
                <ul className="dash-list">
                  {d.patients.recent.map((p) => (
                    <li key={p.id}>
                      <span><b>{p.name}</b><small>Last visit {fmtWhen(p.lastVisit)}</small></span>
                      <em>{p.visits} visit{p.visits === 1 ? '' : 's'}</em>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Recent bills</h3>
                {d.recentBills.length === 0 ? (
                  <p className="muted small">No bills yet.</p>
                ) : (
                  <ul className="dash-list">
                    {d.recentBills.map((b) => (
                      <li key={b.id}>
                        <span><b>{b.patient}</b><small>{b.invoiceNo}</small></span>
                        <span className="dash-amt"><b>{inr(b.doctorSharePaise)}</b><em className={`pill ${b.status}`}>{b.status}</em></span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="muted small">Your share is the consultation fee. The platform fee and its GST belong to VITALINK.</p>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
