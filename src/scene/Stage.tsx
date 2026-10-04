import { useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils, type Group } from 'three'
import { view, weight } from '../lib/scroll'

type Props = {
  index: number
  /** -1 = left column, 0 = centre, +1 = right column (desktop) */
  side: -1 | 0 | 1
  children: ReactNode
}

/** Positions a section's 3D object next to its HTML copy and fades it in/out on scroll. */
export function Stage({ index, side, children }: Props) {
  const g = useRef<Group>(null)
  const w = useRef(0)
  const { viewport, size } = useThree()
  const mobile = size.width < 860

  useFrame((_, dt) => {
    const grp = g.current
    if (!grp) return
    w.current = MathUtils.damp(w.current, weight(index), 6, dt)
    const cur = w.current
    grp.visible = cur > 0.004
    if (!grp.visible) return
    const k = mobile ? 0.58 : 1
    grp.scale.setScalar(Math.max(0.0001, cur * k))
    const tx = mobile ? 0 : side * viewport.width * 0.235
    const ty = mobile ? viewport.height * 0.25 : 0
    grp.position.x = tx
    grp.position.y = ty + (1 - cur) * -1.2
    grp.rotation.y = MathUtils.damp(grp.rotation.y, view.px * 0.28 + (1 - cur) * 0.9, 4, dt)
    grp.rotation.x = MathUtils.damp(grp.rotation.x, view.py * 0.12, 4, dt)
  })

  return (
    <group ref={g} visible={false}>
      {children}
    </group>
  )
}
