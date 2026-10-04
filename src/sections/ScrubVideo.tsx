import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

type Props = {
  id: string
  src: string
  /** scroll distance in viewport heights the video is pinned for */
  length?: number
  children?: ReactNode
}

/**
 * Pins a full-screen video and maps scroll progress to video time.
 * Files are encoded all-intra (every frame a keyframe) so seeking is instant and smooth.
 * currentTime is eased toward the target each frame, so wheel/touch jumps never judder.
 */
export function ScrubVideo({ id, src, length = 3, children }: Props) {
  const wrap = useRef<HTMLElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const copy = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const w = wrap.current
    const v = video.current
    if (!w || !v) return
    let target = 0
    let current = 0
    let raf = 0
    let visible = false

    const progress = () => {
      const r = w.getBoundingClientRect()
      const span = Math.max(1, r.height - window.innerHeight)
      return Math.min(1, Math.max(0, -r.top / span))
    }
    const tick = () => {
      raf = 0
      if (!visible) return
      const p = progress()
      if (v.duration) target = p * (v.duration - 0.02)
      current += (target - current) * 0.18
      if (Math.abs(target - current) < 0.0005) current = target
      if (Math.abs(v.currentTime - current) > 1 / 120) v.currentTime = current
      if (copy.current) {
        copy.current.style.opacity = String(Math.min(1, p * 6, (1 - p) * 6))
        copy.current.style.transform = `translateY(${(0.5 - p) * 40}px)`
      }
      raf = requestAnimationFrame(tick)
    }
    const start = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting
        if (visible) start()
      },
      { rootMargin: '10% 0px' },
    )
    io.observe(w)
    v.pause()
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section id={id} ref={wrap} className="scrub" style={{ height: `${(length + 1) * 100}vh` }}>
      <div className="scrub-pin">
        <video ref={video} src={src} muted playsInline preload="auto" tabIndex={-1} aria-hidden="true" />
        <div className="scrub-shade" />
        <div ref={copy} className="scrub-copy">
          {children}
        </div>
      </div>
    </section>
  )
}

export const HeartScrub = () => (
  <ScrubVideo id="heart" src="/video/heart.mp4" length={3}>
    <p className="eyebrow">Every beat, accounted for</p>
    <h2>Your heart, always in view.</h2>
  </ScrubVideo>
)

export const MorphScrub = () => (
  <ScrubVideo id="morph" src="/video/morph.mp4" length={3}>
    <p className="eyebrow">From organ to wrist</p>
    <h2>VitalBand turns every heartbeat into a signal.</h2>
  </ScrubVideo>
)
