import { lazy, Suspense, useEffect, useState } from 'react'
import { bindScroll } from './lib/scroll'
import { Nav } from './sections/Nav'
import {
  Closing,
  Data,
  Hero,
  Intent,
  Platform,
  Problem,
  Stack,
  VitalBand,
} from './sections/Sections'

const Scene = lazy(() => import('./scene/Scene').then((m) => ({ default: m.Scene })))

function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function App() {
  const [webgl] = useState(hasWebGL)
  useEffect(() => bindScroll(), [])

  return (
    <>
      {webgl && (
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      )}
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Platform />
        <Intent />
        <VitalBand />
        <Stack />
        <Data />
        <Closing />
      </main>
    </>
  )
}
