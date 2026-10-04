import type { ComponentProps } from 'react'

type Props = ComponentProps<'meshPhysicalMaterial'> & { tint?: string }

/**
 * Pastel "glass": cheap, looks right over a CSS gradient (real transmission renders dark
 * on a transparent canvas). Reflections come from the Lightformer environment in Scene.
 */
export function Glass({ tint = '#ffffff', opacity = 0.5, ...rest }: Props) {
  return (
    <meshPhysicalMaterial
      color={tint}
      transparent
      opacity={opacity}
      roughness={0.06}
      metalness={0.05}
      clearcoat={1}
      clearcoatRoughness={0.05}
      iridescence={0.55}
      iridescenceIOR={1.3}
      envMapIntensity={1.6}
      depthWrite={false}
      {...rest}
    />
  )
}
