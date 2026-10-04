import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line, RoundedBox } from '@react-three/drei'
import { ExtrudeGeometry, MathUtils, Shape, type Group, type Mesh } from 'three'
import { Glass } from './Glass'
import { weight } from '../lib/scroll'

const PASTEL = ['#cdbcf2', '#f2b5e4', '#b5d3f7', '#aef0da', '#ffffff']

const reduce =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const SPEED = reduce ? 0.15 : 1

/* ---------- 0 · HERO: glass orb with orbiting capsules ---------- */
export function HeroObject() {
  const core = useRef<Mesh>(null)
  const orbit = useRef<Group>(null)
  const ringA = useRef<Mesh>(null)
  const ringB = useRef<Mesh>(null)

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime * SPEED
    if (core.current) core.current.scale.setScalar(0.55 + 0.05 * Math.sin(t * 2.4) ** 2)
    if (orbit.current) orbit.current.rotation.y += dt * 0.25 * SPEED
    if (ringA.current) ringA.current.rotation.z += dt * 0.12 * SPEED
    if (ringB.current) ringB.current.rotation.x += dt * 0.09 * SPEED
  })

  return (
    <group>
      <mesh>
        <sphereGeometry args={[1.6, 128, 128]} />
        <Glass tint="#dfe6ff" opacity={0.42} side={2} />
      </mesh>
      <mesh ref={core}>
        <sphereGeometry args={[1, 96, 96]} />
        <meshStandardMaterial color="#e9a6dc" emissive="#9d7bea" emissiveIntensity={0.7} roughness={0.35} />
      </mesh>
      <mesh ref={ringA} rotation={[1.2, 0.2, 0]}>
        <torusGeometry args={[2.35, 0.012, 16, 384]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.8} />
      </mesh>
      <mesh ref={ringB} rotation={[0.3, 0.9, 0.5]}>
        <torusGeometry args={[2.75, 0.01, 16, 384]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.5} />
      </mesh>
      <group ref={orbit} rotation={[0.35, 0, 0.25]}>
        {Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2
          const r = 2.35 + (i % 3) * 0.28
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * r, Math.sin(i * 1.7) * 0.45, Math.sin(a) * r]}
              rotation={[a, a * 0.5, 0.6]}
            >
              <capsuleGeometry args={[0.1, 0.26, 16, 40]} />
              <Glass tint={PASTEL[i % 4]} opacity={0.95} />
            </mesh>
          )
        })}
      </group>
    </group>
  )
}

/* ---------- 1 · PROBLEM: a clock that never stops + a long queue ---------- */
export function ProblemObject() {
  const hand = useRef<Mesh>(null)
  const minute = useRef<Group>(null)
  const beads = useRef<(Mesh | null)[]>([])

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    if (minute.current) minute.current.rotation.z -= dt * 2.6 * SPEED
    if (hand.current) hand.current.rotation.z -= dt * 0.22 * SPEED
    beads.current.forEach((m, i) => {
      if (m) m.position.y = -2.35 + Math.sin(t * 1.6 + i * 0.6) * 0.06
    })
  })

  return (
    <group>
      <mesh>
        <circleGeometry args={[1.62, 160]} />
        <Glass opacity={0.4} />
      </mesh>
      <mesh>
        <torusGeometry args={[1.65, 0.07, 40, 320]} />
        <Glass tint="#f2b5e4" opacity={0.9} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.sin(a) * 1.38, Math.cos(a) * 1.38, 0.02]} rotation={[0, 0, -a]}>
            <boxGeometry args={[0.05, i % 3 === 0 ? 0.26 : 0.14, 0.04]} />
            <meshStandardMaterial color="#0b1f2a" />
          </mesh>
        )
      })}
      <mesh ref={hand} position={[0, 0, 0.05]}>
        <boxGeometry args={[0.09, 0.8, 0.05]} />
        <meshStandardMaterial color="#0b1f2a" />
      </mesh>
      <group ref={minute} position={[0, 0, 0.09]}>
        <mesh position={[0, 0.58, 0]}>
          <boxGeometry args={[0.05, 1.16, 0.04]} />
          <meshStandardMaterial color="#fc2e34" emissive="#fc2e34" emissiveIntensity={0.4} />
        </mesh>
      </group>
      <mesh position={[0, 0, 0.12]}>
        <sphereGeometry args={[0.1, 40, 40]} />
        <meshStandardMaterial color="#0b1f2a" />
      </mesh>
      {/* the queue */}
      {Array.from({ length: 15 }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            beads.current[i] = m
          }}
          position={[-1.9 + i * 0.27, -2.35, 0]}
        >
          <sphereGeometry args={[0.11, 48, 48]} />
          <Glass tint={i === 14 ? '#aef0da' : '#cdbcf2'} opacity={0.9} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------- 2 · PLATFORM: six modules in a ring ---------- */
export function PlatformObject() {
  const ring = useRef<Group>(null)
  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.y += dt * 0.3 * SPEED
  })
  return (
    <group>
      <mesh>
        <icosahedronGeometry args={[0.85, 2]} />
        <meshStandardMaterial color="#f7c9ee" emissive="#b9aae3" emissiveIntensity={0.9} flatShading />
      </mesh>
      <group ref={ring} rotation={[0.25, 0, 0]}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2
          return (
            <RoundedBox
              key={i}
              args={[0.8, 0.8, 0.8]}
              radius={0.22}
              smoothness={10}
              position={[Math.cos(a) * 1.8, Math.sin(i * 2.1) * 0.35, Math.sin(a) * 1.8]}
              rotation={[a, a, 0]}
            >
              <Glass tint={PASTEL[i % 4]} opacity={0.7} />
            </RoundedBox>
          )
        })}
      </group>
    </group>
  )
}

/* ---------- 3 · INTENT: one sentence fans out into five structured fields ---------- */
export function IntentObject() {
  const arms = useRef<(Group | null)[]>([])
  const centre = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * SPEED
    arms.current.forEach((g, i) => {
      if (g) g.rotation.z = (i / 5) * Math.PI * 2 + t * 0.35
    })
    if (centre.current) centre.current.scale.setScalar(1 + Math.sin(t * 2) * 0.05)
  })
  return (
    <group>
      <mesh ref={centre}>
        <sphereGeometry args={[0.7, 96, 96]} />
        <meshStandardMaterial color="#cdbcf2" emissive="#b9aae3" emissiveIntensity={1} roughness={0.3} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <group
          key={i}
          ref={(g) => {
            arms.current[i] = g
          }}
          rotation={[i * 0.5, i * 0.7, 0]}
        >
          <Line points={[[0.7, 0, 0], [2.2, 0, 0]]} color="#ffffff" lineWidth={1.4} transparent opacity={0.8} />
          <mesh position={[2.3 + (i % 2) * 0.3, 0, 0]}>
            <sphereGeometry args={[0.24, 64, 64]} />
            <Glass tint={PASTEL[i]} opacity={0.85} />
          </mesh>
        </group>
      ))}
      <mesh rotation={[1.5, 0, 0]}>
        <torusGeometry args={[2.9, 0.01, 16, 384]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
      </mesh>
    </group>
  )
}

/* ---------- 5 · STACK: four layers, exploded ---------- */
const LAYERS = ['#aef0da', '#b5d3f7', '#cdbcf2', '#f2b5e4']
export function StackObject() {
  const g = useRef<Group>(null)
  const slabs = useRef<(Mesh | null)[]>([])
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime * SPEED
    if (g.current) g.current.rotation.y += dt * 0.25 * SPEED
    slabs.current.forEach((m, i) => {
      if (m) m.position.y = (1.5 - i) * 0.95 + Math.sin(t * 1.2 + i) * 0.06
    })
  })
  return (
    <group ref={g} rotation={[0.35, 0, 0]}>
      {LAYERS.map((c, i) => (
        <RoundedBox
          key={c}
          ref={(m) => {
            slabs.current[i] = m
          }}
          args={[3.4, 0.34, 2.3]}
          radius={0.14}
          smoothness={10}
          position={[0, (1.5 - i) * 0.95, 0]}
        >
          <Glass tint={c} opacity={0.82} />
        </RoundedBox>
      ))}
      <Line points={[[0, 2.2, 0], [0, -2.2, 0]]} color="#ffffff" lineWidth={1.2} transparent opacity={0.6} />
    </group>
  )
}

/* ---------- 6 · DATA: 98.6 min waiting vs 6.5 min consultation ---------- */
export function DataObject() {
  const wait = useRef<Mesh>(null)
  const talk = useRef<Mesh>(null)
  const grow = useRef(0)
  const MAX = 3.1
  useFrame((_, dt) => {
    grow.current = MathUtils.damp(grow.current, weight(6) > 0.6 ? 1 : 0, 2.2, dt)
    const e = 1 - (1 - grow.current) ** 3
    if (wait.current) {
      wait.current.scale.y = Math.max(0.001, e)
      wait.current.position.y = (MAX * e) / 2 - 1.95
    }
    if (talk.current) {
      const h = MAX * (6.5 / 98.6)
      talk.current.scale.y = Math.max(0.001, e)
      talk.current.position.y = (h * e) / 2 - 1.95
    }
  })
  return (
    <group rotation={[0.12, -0.35, 0]}>
      <RoundedBox args={[4.2, 0.18, 2.2]} radius={0.08} position={[0, -2.04, 0]}>
        <Glass opacity={0.7} />
      </RoundedBox>
      <mesh ref={wait} position={[-0.85, -1.95, 0]}>
        <boxGeometry args={[1.1, MAX, 1.1]} />
        <Glass tint="#f2a0cf" opacity={0.85} />
      </mesh>
      <mesh ref={talk} position={[0.85, -1.95, 0]}>
        <boxGeometry args={[1.1, MAX * (6.5 / 98.6), 1.1]} />
        <Glass tint="#7fe9c6" opacity={0.95} />
      </mesh>
    </group>
  )
}

/* ---------- 7 · CLOSING: heart + pulse rings ---------- */
export function ClosingObject() {
  const heart = useRef<Group>(null)
  const rings = useRef<(Mesh | null)[]>([])
  const geo = useMemo(() => {
    const s = new Shape()
    s.moveTo(0.5, 0.5)
    s.bezierCurveTo(0.5, 0.5, 0.4, 0, 0, 0)
    s.bezierCurveTo(-0.6, 0, -0.6, 0.7, -0.6, 0.7)
    s.bezierCurveTo(-0.6, 1.1, -0.3, 1.54, 0.5, 1.9)
    s.bezierCurveTo(1.2, 1.54, 1.6, 1.1, 1.6, 0.7)
    s.bezierCurveTo(1.6, 0.7, 1.6, 0, 1.0, 0)
    s.bezierCurveTo(0.7, 0, 0.5, 0.5, 0.5, 0.5)
    const g = new ExtrudeGeometry(s, {
      depth: 0.5,
      bevelEnabled: true,
      bevelThickness: 0.18,
      bevelSize: 0.18,
      bevelSegments: 20,
      curveSegments: 72,
    })
    g.center()
    return g
  }, [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * SPEED
    const beat = Math.max(Math.exp(-((t * 1.2) % 1) * 7), 0.6 * Math.exp(-120 * (((t * 1.2) % 1) - 0.28) ** 2))
    if (heart.current) {
      heart.current.scale.setScalar(1 + beat * 0.12)
      heart.current.rotation.y = Math.sin(t * 0.5) * 0.35
    }
    rings.current.forEach((m, i) => {
      if (!m) return
      const p = (t * 0.35 + i / 3) % 1
      m.scale.setScalar(1 + p * 0.7)
      ;(m.material as { opacity: number }).opacity = (1 - p) * 0.7
    })
  })

  return (
    <group>
      <group ref={heart} scale={1.05} rotation={[0, 0, Math.PI]}>
        <mesh geometry={geo}>
          <Glass tint="#ee7fc4" opacity={0.92} />
        </mesh>
      </group>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            rings.current[i] = m
          }}
          position={[0, 0, -0.3]}
        >
          <torusGeometry args={[2.1, 0.018, 16, 320]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

