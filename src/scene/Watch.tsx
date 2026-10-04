import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { CanvasTexture, SRGBColorSpace, type Mesh, type MeshBasicMaterial } from 'three'
import { vitals } from '../lib/vitals'

const W = 320
const H = 400
// The screen is drawn in a 320x400 coordinate space but rasterised at 3x (960x1200), so the big BPM
// digits stay razor sharp even when the watch fills a 1080p / 4K screen.
const S = 3

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

function draw(c: CanvasRenderingContext2D, bpm: number, temp: string, anomaly: boolean) {
  c.setTransform(S, 0, 0, S, 0, 0)
  c.clearRect(0, 0, W, H)
  const g = c.createLinearGradient(0, 0, 0, H)
  if (anomaly) {
    g.addColorStop(0, '#ffd1d4')
    g.addColorStop(1, '#ff7a80')
  } else {
    g.addColorStop(0, '#cfd6f7')
    g.addColorStop(1, '#f0b6e6')
  }
  rr(c, 0, 0, W, H, 54)
  c.fillStyle = g
  c.fill()
  c.fillStyle = '#0b1f2a'
  c.textAlign = 'center'
  c.font = '700 132px Inter, system-ui, sans-serif'
  c.fillText(String(bpm), W / 2, 170)
  c.font = '500 24px Inter, system-ui, sans-serif'
  c.fillText(`BPM  ·  ${temp}°C`, W / 2, 220)
  // status pill
  rr(c, 40, 262, W - 80, 54, 12)
  c.fillStyle = anomaly ? '#fc2e34' : '#0b1f2a'
  c.fill()
  c.fillStyle = '#ffffff'
  c.font = '700 22px Inter, system-ui, sans-serif'
  c.fillText(anomaly ? 'ANOMALY · ALERT SENT' : 'ANOMALY', W / 2, 297)
  // tiny ecg
  c.strokeStyle = anomaly ? '#fc2e34' : '#0b1f2a'
  c.lineWidth = 4
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.beginPath()
  c.moveTo(40, 355)
  c.lineTo(100, 355)
  c.lineTo(118, 335)
  c.lineTo(140, 378)
  c.lineTo(160, 345)
  c.lineTo(176, 355)
  c.lineTo(280, 355)
  c.stroke()
}

export function Watch() {
  const rings = useRef<(Mesh | null)[]>([])
  const screen = useRef<MeshBasicMaterial>(null)
  const last = useRef({ key: '', t: -1 })
  const maxAniso = useThree((st) => st.gl.capabilities.getMaxAnisotropy())

  const { canvas, tex } = useMemo(() => {
    const cv = document.createElement('canvas')
    cv.width = W * S
    cv.height = H * S
    const t = new CanvasTexture(cv)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = maxAniso
    return { canvas: cv, tex: t }
  }, [maxAniso])

  useEffect(() => () => tex.dispose(), [tex])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const anomaly = vitals.get().anomaly
    const bpm = Math.round(anomaly ? 148 + 5 * Math.sin(t * 5) : 72 + 3 * Math.sin(t * 1.3))
    const temp = anomaly ? '38.9' : '36.6'
    const key = `${bpm}|${temp}|${anomaly}`
    if (key !== last.current.key) {
      const c = canvas.getContext('2d')
      if (c) {
        draw(c, bpm, temp, anomaly)
        tex.needsUpdate = true
      }
      last.current.key = key
    }
    rings.current.forEach((m, i) => {
      if (!m) return
      const speed = anomaly ? 1.2 : 0.4
      const p = (t * speed + i / 3) % 1
      m.scale.setScalar(1 + p * 0.9)
      const mat = m.material as MeshBasicMaterial
      mat.opacity = (1 - p) * 0.55
      mat.color.set(anomaly ? '#fc2e34' : '#2ee6a6')
    })
  })

  return (
    <group rotation={[0.05, -0.32, 0.04]}>
      {/* straps */}
      <RoundedBox args={[0.95, 1.5, 0.12]} radius={0.06} position={[0, 1.55, -0.04]}>
        <meshStandardMaterial color="#173240" roughness={0.5} />
      </RoundedBox>
      <RoundedBox args={[0.95, 1.5, 0.12]} radius={0.06} position={[0, -1.55, -0.04]}>
        <meshStandardMaterial color="#173240" roughness={0.5} />
      </RoundedBox>
      {/* case */}
      <RoundedBox args={[1.6, 2.0, 0.3]} radius={0.24} smoothness={12}>
        <meshPhysicalMaterial color="#0b1f2a" roughness={0.18} metalness={0.6} clearcoat={1} />
      </RoundedBox>
      {/* crown */}
      <mesh position={[0.84, 0.35, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.16, 48]} />
        <meshStandardMaterial color="#9aa8b4" metalness={0.8} roughness={0.25} />
      </mesh>
      {/* screen */}
      <mesh position={[0, 0, 0.156]}>
        <planeGeometry args={[1.36, 1.7]} />
        <meshBasicMaterial ref={screen} map={tex} transparent toneMapped={false} />
      </mesh>
      {/* pulse rings */}
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            rings.current[i] = m
          }}
          position={[0, 0, -0.25]}
        >
          <torusGeometry args={[1.5, 0.014, 16, 256]} />
          <meshBasicMaterial color="#2ee6a6" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}
