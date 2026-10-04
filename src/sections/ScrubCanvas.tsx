import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

type Props = {
  id: string
  dir: string // folder under /frames, files are 0001.webp ...
  frames: number
  length?: number // pinned scroll distance, in viewport heights
  children?: ReactNode
}

const pad = (n: number) => String(n).padStart(4, '0')

/**
 * Image-sequence scrolling (the Apple product-page technique):
 * GSAP ScrollTrigger pins the section and scrubs a frame index, a canvas draws that frame.
 * No video seeking or decoding, so it stays at the display refresh rate.
 */
export function ScrubCanvas({ id, dir, frames, length = 2.5, children }: Props) {
  const wrap = useRef<HTMLElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const copy = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(0)

  useEffect(() => {
    const el = wrap.current
    const cv = canvas.current
    if (!el || !cv) return
    const ctx = cv.getContext('2d', { alpha: false })!
    const imgs: HTMLImageElement[] = new Array(frames)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const state = { frame: reduce ? Math.floor(frames * 0.4) : 0 }
    el.classList.toggle('is-static', reduce)
    let shown = -1
    let done = 0

    const draw = (i: number) => {
      // fall back to the nearest frame that has loaded so far
      let k = Math.round(i)
      while (k > 0 && !imgs[k]?.complete) k--
      const img = imgs[k]
      if (!img || !img.naturalWidth || k === shown) return
      shown = k
      // object-fit: cover
      const s = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight)
      const w = img.naturalWidth * s
      const h = img.naturalHeight * s
      ctx.drawImage(img, (cv.width - w) / 2, (cv.height - h) / 2, w, h)
    }
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      cv.width = Math.round(cv.clientWidth * dpr)
      cv.height = Math.round(cv.clientHeight * dpr)
      shown = -1
      draw(state.frame)
    }

    // frames download only when the section is within ~2 screens of the viewport
    const load = (i: number) => {
      const im = new Image()
      im.decoding = 'async'
      im.onload = () => {
        done++
        setLoaded(done)
        if (i === 0 || reduce) size()
      }
      im.src = `/frames/${dir}/${pad(i + 1)}.webp`
      imgs[i] = im
    }
    let started = false
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || started) return
        started = true
        io.disconnect()
        if (reduce) load(state.frame)
        else for (let i = 0; i < frames; i++) load(i)
      },
      { rootMargin: '200% 0px' },
    )
    io.observe(el)

    const ctxGsap = gsap.context(() => {
      if (reduce) {
        gsap.set(copy.current, { autoAlpha: 1 })
        return
      }
      gsap.to(state, {
        frame: frames - 1,
        ease: 'none',
        onUpdate: () => draw(state.frame),
        scrollTrigger: {
          trigger: el,
          start: 'top top',
          end: `+=${length * 100}%`,
          pin: '.scrub-pin',
          scrub: 0.4, // eased catch-up to the scrollbar
          onToggle: (self) => window.dispatchEvent(new CustomEvent('scrub-active', { detail: { id, on: self.isActive } })),
        },
      })
      gsap.fromTo(
        copy.current,
        { autoAlpha: 0, y: 40 },
        {
          autoAlpha: 1,
          y: 0,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top top-=8%', end: '+=25%', scrub: true },
        },
      )
    }, el)

    window.addEventListener('resize', size)
    return () => {
      window.removeEventListener('resize', size)
      io.disconnect()
      ctxGsap.revert()
    }
  }, [dir, frames, id, length])

  return (
    <section id={id} ref={wrap} className="scrub">
      <div className="scrub-pin" style={{ backgroundImage: `url(/frames/${dir}/0001.webp)` }}>
        <canvas ref={canvas} aria-hidden="true" />
        <div className="scrub-shade" />
        <div ref={copy} className="scrub-copy">
          {children}
        </div>
        {loaded > 0 && loaded < frames && <div className="scrub-load" style={{ width: `${(loaded / frames) * 100}%` }} />}
      </div>
    </section>
  )
}

const scene = (id: string, frames: number, eyebrow: string, title: string) => () => (
  <ScrubCanvas id={`scene-${id}`} dir={id} frames={frames}>
    <p className="eyebrow">{eyebrow}</p>
    <h2>{title}</h2>
  </ScrubCanvas>
)

// frame counts come from public/frames/<name>/ (24 fps, 1920x1080 WebP)
export const HeartScrub = scene('heart', 240, 'Every beat, accounted for', 'Your heart, always in view.')
export const ProblemScrub = scene('problem', 239, 'The old way', 'Healthcare waits. Patients pay.')
export const PlatformScrub = scene('platform', 238, 'The fix', 'One platform. Zero delay.')
export const IntentScrub = scene('intent', 239, 'Just say it', 'Speak. It books.')
export const MorphScrub = scene('morph', 190, 'From organ to wrist', 'VitalBand turns every heartbeat into a signal.')
export const StackScrub = scene('stack', 239, 'Under the hood', 'Built to ship. Built to win.')
export const DataScrub = scene('data', 177, 'One history', 'Every record, one view.')
export const ClosingScrub = scene('closing', 189, 'VITALINK', 'Care that never waits.')
