const LINKS = [
  ['Problem', '#problem'],
  ['Platform', '#platform'],
  ['CITYCARE AI', '#intent'],
  ['VitalBand', '#vitalband'],
  ['Stack', '#stack'],
  ['Data', '#data'],
] as const

export function Nav() {
  return (
    <header className="nav glass-bar">
      <a className="brand" href="#hero" aria-label="VITALINK home">
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
      </nav>
      <a className="btn btn-solid nav-cta" href="#intent">
        Book now
      </a>
    </header>
  )
}
