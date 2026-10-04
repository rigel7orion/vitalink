// Shared, framework-free scroll + pointer state. The 3D scene reads it every frame;
// no React re-renders are triggered by scrolling.
export const SECTION_IDS = [
  'hero',
  'problem',
  'platform',
  'intent',
  'vitalband',
  'stack',
  'data',
  'closing',
] as const

export const view = {
  /** continuous section index, e.g. 2.4 = 40% of the way through section 2 */
  s: 0,
  px: 0,
  py: 0,
}

// Background palettes per section [top, bottom] as RGB.
type RGB = [number, number, number]
const PALETTE: [RGB, RGB][] = [
  [[214, 246, 252], [150, 205, 232]], // hero
  [[205, 240, 250], [160, 190, 232]], // problem
  [[196, 232, 245], [128, 178, 226]], // platform
  [[212, 236, 250], [176, 176, 232]], // intent
  [[150, 200, 240], [70, 130, 215]], // vitalband
  [[160, 208, 242], [90, 150, 222]], // stack
  [[226, 232, 242], [170, 190, 226]], // data
  [[216, 224, 242], [150, 168, 222]], // closing
]

const mix = (a: RGB, b: RGB, t: number) =>
  a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')

export function readScroll() {
  const els = SECTION_IDS.map((id) => document.getElementById(id))
  const mid = window.innerHeight * 0.5
  let s = 0
  for (let i = 0; i < els.length; i++) {
    const el = els[i]
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.top <= mid) s = i + Math.min(1, Math.max(0, (mid - r.top) / r.height))
  }
  view.s = s
  const i = Math.min(PALETTE.length - 2, Math.floor(s))
  const t = Math.min(1, Math.max(0, s - i))
  const root = document.documentElement.style
  root.setProperty('--bg-a', mix(PALETTE[i][0], PALETTE[i + 1][0], t))
  root.setProperty('--bg-b', mix(PALETTE[i][1], PALETTE[i + 1][1], t))
}

export function bindScroll() {
  const onScroll = () => readScroll()
  const onMove = (e: PointerEvent) => {
    view.px = (e.clientX / window.innerWidth) * 2 - 1
    view.py = (e.clientY / window.innerHeight) * 2 - 1
  }
  readScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
  window.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onScroll)
    window.removeEventListener('pointermove', onMove)
  }
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/**
 * Visibility of section `index`'s 3D object: fades in as the section approaches the
 * middle of the viewport, stays through most of it, then hands over to the next one.
 */
export const weight = (index: number) => {
  const last = SECTION_IDS.length - 1
  const rise = smooth((view.s - (index - 0.5)) / 0.5)
  const fall = index === last ? 1 : 1 - smooth((view.s - (index + 0.6)) / 0.5)
  return Math.min(rise, fall)
}
