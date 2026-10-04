import { useSyncExternalStore } from 'react'

/** Tiny History-API router (no dependency): real URLs like /book and /bills. */
export type Route = '/' | '/book' | '/band' | '/bills' | '/dashboard'
const PAGES: Route[] = ['/', '/book', '/band', '/bills', '/dashboard']
const ALIASES: Record<string, Route> = { '/orders': '/bills', '/home': '/' }

export const TITLES: Record<Route, string> = {
  '/': 'VITALINK',
  '/book': 'Book an appointment · VITALINK',
  '/band': 'VitalBand · VITALINK',
  '/bills': 'My bills · VITALINK',
  '/dashboard': 'Doctor dashboard · VITALINK',
}

export function parseRoute(pathname: string): Route {
  const p = '/' + pathname.replace(/^\/+|\/+$/g, '').toLowerCase()
  const r = (ALIASES[p] ?? p) as Route
  return PAGES.includes(r) ? r : '/'
}

const EVT = 'vl:navigate'
const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb)
  window.addEventListener(EVT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener(EVT, cb)
  }
}
export const useRoute = (): Route => useSyncExternalStore(subscribe, () => parseRoute(window.location.pathname), () => '/')

export function navigate(path: string) {
  if (path === window.location.pathname + window.location.search) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new Event(EVT))
  window.scrollTo({ top: 0, behavior: 'instant' })
}

/**
 * Turns normal internal links (<a href="/book">) into client-side navigation, so the 3D scene keeps
 * running between pages. Ctrl/Cmd-click, new-tab links and external links are left to the browser.
 */
export function bindPageScroll() {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element | null)?.closest?.('a')
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return
    const href = a.getAttribute('href')
    if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return
    e.preventDefault()
    navigate(href)
  }
  const onPop = () => window.scrollTo({ top: 0, behavior: 'instant' })
  document.addEventListener('click', onClick)
  window.addEventListener('popstate', onPop)
  return () => {
    document.removeEventListener('click', onClick)
    window.removeEventListener('popstate', onPop)
  }
}
