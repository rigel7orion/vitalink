import { useEffect, useState } from 'react'
import { api, ApiError, useSession, type Invoice } from '../lib/api'
import { Bill } from './Bill'
import { openAuth } from './live'

/** Patient's own invoices, newest first. Each one reuses the same Bill card (pay, PDF, WhatsApp, email). */
export function BillsPage() {
  const session = useSession()
  const [list, setList] = useState<Invoice[] | null>(null)
  const [err, setErr] = useState('')
  const isPatient = session?.user.role === 'patient'

  useEffect(() => {
    if (!isPatient) return setList(null)
    api<Invoice[]>('/invoices')
      .then(setList)
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load your bills'))
  }, [isPatient])

  return (
    <section id="platform" className="section">
      <div className="col wide">
        <h2>My bills</h2>
        {!isPatient ? (
          <div className="glass soft" style={{ padding: 20 }}>
            <p>Sign in with a patient account to see your bills.</p>
            <button className="btn btn-solid" onClick={() => openAuth()}>
              Sign in
            </button>
          </div>
        ) : err ? (
          <p className="error" role="alert">{err}</p>
        ) : !list ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <div className="glass soft" style={{ padding: 20 }}>
            <p>No bills yet. Book an appointment and your bill shows up here.</p>
            <a className="btn btn-solid" href="/book">
              Book now
            </a>
          </div>
        ) : (
          <div className="glass soft" style={{ padding: 16, display: 'grid', gap: 12 }}>
            {list.map((inv) => (
              <Bill key={inv.id} invoice={inv} onChange={(n) => setList((l) => l && l.map((x) => (x.id === n.id ? n : x)))} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
