import { signOut, useSession } from '../lib/api'
import { openAuth } from './live'

const LINKS = [
  ['Home', '/'],
  ['Book', '/book'],
  ['VitalBand', '/band'],
] as const

export function Nav() {
  const session = useSession()
  return (
    <header className="nav glass-bar">
      <a className="brand" href="/" aria-label="VITALINK home">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="9" fill="#b9aae3" />
          <path d="M4 17h6l3-7 5 13 3-6h7" fill="none" stroke="#0b1f2a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        VITALINK
      </a>
      <nav aria-label="Primary">
        {LINKS.map(([label, href]) => (
          <a key={href} href={href}>
            {label}
          </a>
        ))}
        {session?.user.role === 'patient' && <a href="/bills">My bills</a>}
        {session?.user.role === 'doctor' && <a href="/dashboard">Dashboard</a>}
      </nav>
      <div className="nav-actions">
        {session ? (
          <>
            <button className="btn btn-ghost nav-auth" onClick={signOut} title="Sign out">
              {session.user.name.split(' ')[0]} · Sign out
            </button>
          </>
        ) : (
          <button className="btn btn-ghost nav-auth" onClick={() => openAuth()}>
            Sign in
          </button>
        )}
        <a className="btn btn-solid nav-cta" href="/book">
          Book now
        </a>
      </div>
    </header>
  )
}
