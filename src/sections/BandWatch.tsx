import { useEffect, useState } from 'react'
import { useVitals } from '../lib/vitals'

// one PQRST beat, 200 units wide; drawn twice so the translate loop is seamless
const BEAT = 'M0 50 H46 q8 -9 16 0 H84 l5 8 l7 -44 l7 56 l5 -20 H132 q12 -14 26 0 H200'
const ECG = `${BEAT} ${BEAT.replace(/M0 50/, 'M200 50').replace(/H(\d+)/g, (_, n) => `H${Number(n) + 200}`)}`

/** Live VitalBand: reads the shared anomaly flag, so "Simulate an anomaly" drives it. */
export function BandWatch() {
  const { anomaly } = useVitals()
  const [bpm, setBpm] = useState(72)
  const [temp, setTemp] = useState(36.6)

  useEffect(() => {
    const base = anomaly ? 148 : 72
    const t0 = anomaly ? 38.9 : 36.6
    const tick = () => {
      setBpm(base + Math.round((Math.random() - 0.5) * 4))
      setTemp(Math.round((t0 + (Math.random() - 0.5) * 0.1) * 10) / 10)
    }
    tick()
    const id = window.setInterval(tick, 900)
    return () => window.clearInterval(id)
  }, [anomaly])

  const beat = `${(60 / (anomaly ? 148 : 72)).toFixed(2)}s`
  return (
    <div
      className={`band-watch ${anomaly ? 'hot' : ''}`}
      style={{ ['--beat' as string]: beat }}
      role="img"
      aria-label={`VitalBand showing ${bpm} beats per minute, ${temp} degrees, ${anomaly ? 'abnormal' : 'normal'}`}
    >
      <span className="bw-strap bw-strap-top" />
      <span className="bw-strap bw-strap-bot" />
      <span className="bw-crown" />
      <div className="bw-case">
        <div className="bw-screen">
          <span className="bw-glare" />
          <p className="bw-brand">VITALBAND</p>
          <p className="bw-bpm">
            <b>{bpm}</b>
            <span>BPM</span>
          </p>
          <svg className="bw-ecg" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
            <g className="bw-ecg-run">
              <path d={ECG} />
            </g>
          </svg>
          <p className="bw-foot">
            <i className="bw-heart" aria-hidden="true" />
            {temp.toFixed(1)}°C · {anomaly ? 'ALERT SENT' : 'NORMAL'}
          </p>
        </div>
      </div>
    </div>
  )
}
