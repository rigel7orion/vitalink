import { Suspense, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, PerformanceMonitor, Stats } from '@react-three/drei'
import { MathUtils } from 'three'
import { Stage } from './Stage'
import { Watch } from './Watch'
import {
  ClosingObject,
  DataObject,
  HeroObject,
  IntentObject,
  PlatformObject,
  ProblemObject,
  StackObject,
} from './Objects'
import { view } from '../lib/scroll'

function Rig() {
  const { camera } = useThree()
  useFrame((_, dt) => {
    camera.position.x = MathUtils.damp(camera.position.x, view.px * 0.5, 3, dt)
    camera.position.y = MathUtils.damp(camera.position.y, -view.py * 0.3, 3, dt)
    camera.lookAt(0, 0, 0)
  })
  return null
}

// Add ?fps to the URL (http://localhost:5173/?fps) to show a live FPS / frame-time meter.
const SHOW_FPS = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fps')

export function Scene() {
  // Quality ladder. Start supersampled: at least 1.5x even on a plain 1080p (1x) monitor, 2x on
  // hi-dpi screens. That is what makes edges and glass reflections look HD. If the GPU can't hold
  // the display's refresh rate, resolution steps down toward 1x and climbs back when there's headroom.
  const max = Math.min(2, Math.max(1.5, typeof window === 'undefined' ? 1.5 : window.devicePixelRatio || 1))
  const [dpr, setDpr] = useState(max)
  // Stop rendering the 3D scene while a full-screen image sequence is on screen.
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const on = new Set<string>()
    const h = (e: Event) => {
      const { id, on: v } = (e as CustomEvent).detail
      v ? on.add(id) : on.delete(id)
      setPaused(on.size > 0)
    }
    window.addEventListener('scrub-active', h)
    return () => window.removeEventListener('scrub-active', h)
  }, [])
  return (
    <Canvas
      className="scene"
      dpr={dpr}
      frameloop={paused ? 'never' : 'always'}
      camera={{ position: [0, 0, 9.5], fov: 40 }}
      gl={{ alpha: true, antialias: true, stencil: false, powerPreference: 'high-performance' }}
    >
      <PerformanceMonitor
        // [decline below, incline above] in fps. On a 60 Hz display a healthy frame rate sits right at
        // 60, so the "incline" bar must be under 60 or resolution would never recover after a dip.
        bounds={(hz) => (hz > 90 ? [60, 100] : [52, 58])}
        onChange={({ factor }) => setDpr(Math.min(max, Math.max(1, Math.round((0.7 + 1.3 * factor) * max * 100) / 100)))}
        onFallback={() => setDpr(Math.max(1, Math.round(max * 0.8 * 100) / 100))}
      />
      {SHOW_FPS && <Stats />}
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 5, 6]} intensity={1.4} />
      <directionalLight position={[-5, -2, 3]} intensity={0.5} color="#d6c8ff" />
      <Suspense fallback={null}>
        <Environment resolution={512} frames={1}>
          <color attach="background" args={['#05070d']} />
          <Lightformer form="rect" intensity={5} position={[-4, 3, 4]} scale={[7, 4, 1]} color="#ffffff" />
          <Lightformer form="rect" intensity={2.4} position={[5, -1, 3]} scale={[4, 7, 1]} color="#cfd0ff" />
          <Lightformer form="ring" intensity={3.5} position={[0, 4, -3]} scale={5} color="#ffd6f0" />
          <Lightformer form="rect" intensity={2} position={[0, -5, 2]} scale={[8, 2, 1]} color="#aef0da" />
        </Environment>
      </Suspense>
      <Rig />
      <Stage index={0} side={1}>
        <HeroObject />
      </Stage>
      <Stage index={1} side={1}>
        <ProblemObject />
      </Stage>
      <Stage index={2} side={1}>
        <PlatformObject />
      </Stage>
      <Stage index={3} side={1}>
        <IntentObject />
      </Stage>
      <Stage index={4} side={-1}>
        <Watch />
      </Stage>
      <Stage index={5} side={1}>
        <StackObject />
      </Stage>
      <Stage index={6} side={1}>
        <DataObject />
      </Stage>
      <Stage index={7} side={1}>
        <ClosingObject />
      </Stage>
    </Canvas>
  )
}
