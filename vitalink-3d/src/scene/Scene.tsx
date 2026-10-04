import { Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
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

export function Scene() {
  return (
    <Canvas
      className="scene"
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 9.5], fov: 40 }}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 5, 6]} intensity={1.4} />
      <directionalLight position={[-5, -2, 3]} intensity={0.5} color="#d6c8ff" />
      <Suspense fallback={null}>
        <Environment resolution={256}>
          <color attach="background" args={['#b9dcf0']} />
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
