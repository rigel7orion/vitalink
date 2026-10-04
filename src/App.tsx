import { useEffect } from 'react'
import { bindScroll } from './lib/scroll'
import { bindPageScroll, TITLES, useRoute } from './lib/route'
import { BillsPage } from './sections/Bills'
import {
  ClosingScrub,
  DataScrub,
  HeartScrub,
  IntentScrub,
  MorphScrub,
  PlatformScrub,
  ProblemScrub,
  StackScrub,
} from './sections/ScrubCanvas'
import { Nav } from './sections/Nav'
import { AuthDialog } from './sections/live'
import { DoctorDashboardSection } from './sections/Dashboard'
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

export default function App() {
  const route = useRoute()
  useEffect(() => bindPageScroll(), [])
  useEffect(() => {
    document.title = TITLES[route]
  }, [route])
  useEffect(() => bindScroll(), [])

  return (
    <>
      <Nav />
      <AuthDialog />
      <main key={route}>
        {route === '/' && (
          <>
            <Hero />
            <HeartScrub />
            <ProblemScrub />
            <Problem />
            <PlatformScrub />
            <Platform />
            <IntentScrub />
            <Intent />
            <MorphScrub />
            <VitalBand />
            <StackScrub />
            <Stack />
            <DataScrub />
            <Data />
            <ClosingScrub />
            <Closing />
          </>
        )}
        {route === '/book' && <Intent live />}
        {route === '/band' && <VitalBand live />}
        {route === '/bills' && <BillsPage />}
        {route === '/dashboard' && <DoctorDashboardSection />}
      </main>
    </>
  )
}
