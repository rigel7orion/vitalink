// Shared, framework-free scroll + pointer state. The 3D scene reads it every frame;
// no React re-renders are triggered by scrolling.
import Lenis from 'lenis'

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

// Section geometry is measured once (and on resize / content change), never inside the scroll
// handler: calling getBoundingClientRect on every scroll event forces a layout each time.
let tops: number[] = []
let heights: number[] = []
function measure() {
  const y = window.scrollY
  tops = []
  heights = []
  SECTION_IDS.forEach((id, i) => {
    const el = document.getElementById(id)
    if (!el) {
      tops[i] = Infinity
      heights[i] = 1
      return
    }
    const r = el.getBoundingClientRect()
    tops[i] = r.top + y
    heights[i] = r.height || 1
  })
}

// Only touch the DOM when the background colour actually changes.
let lastA = ''
let lastB = ''

export function readScroll() {
  const mid = window.scrollY + window.innerHeight * 0.5
  let s = 0
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= mid) s = i + Math.min(1, Math.max(0, (mid - tops[i]) / heights[i]))
  }
  view.s = s
  const i = Math.min(PALETTE.length - 2, Math.floor(s))
  const t = Math.min(1, Math.max(0, s - i))
  const a = mix(PALETTE[i][0], PALETTE[i + 1][0], t)
  const b = mix(PALETTE[i][1], PALETTE[i + 1][1], t)
  const root = document.documentElement.style
  if (a !== lastA) root.setProperty('--bg-a', (lastA = a))
  if (b !== lastB) root.setProperty('--bg-b', (lastB = b))
}

export function bindScroll() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const onMove = (e: PointerEvent) => {
    view.px = (e.clientX / window.innerWidth) * 2 - 1
    view.py = (e.clientY / window.innerHeight) * 2 - 1
  }
  measure()
  readScroll()

  // Buttery wheel scrolling on desktop. Touch keeps native momentum, and users who asked for
  // reduced motion keep plain browser scrolling.
  const lenis = reduce ? null : new Lenis({ lerp: 0.09, smoothWheel: true, anchors: true, autoRaf: true })
  lenis?.on('scroll', readScroll)

  let raf = 0
  const schedule = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      readScroll()
    })
  }
  const remeasure = () => {
    measure()
    readScroll()
  }
  const ro = new ResizeObserver(remeasure) // fires when content height changes (e.g. the bill appears)
  ro.observe(document.body)
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', remeasure)
  window.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    lenis?.destroy()
    ro.disconnect()
    cancelAnimationFrame(raf)
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', remeasure)
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
