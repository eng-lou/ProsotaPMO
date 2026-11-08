import { lazy, Suspense, useMemo } from 'react'
import * as THREE from 'three'
import type { SiteIllumination, SiteItem } from './siteScene'

// The rectangular emitter's lookup textures are only needed when one is used.
const AreaLight = lazy(async () => {
  const { RectAreaLightUniformsLib } = await import('three/examples/jsm/lights/RectAreaLightUniformsLib.js')
  RectAreaLightUniformsLib.init()
  return { default: ({ item, light }: { item: SiteItem; light: SiteIllumination }) =>
    <rectAreaLight color={item.color} intensity={light.intensity} width={item.width} height={item.depth} /> }
})

export function SiteLight({ item, enabled, showHandle, selected }: {
  item: SiteItem; enabled: boolean; showHandle: boolean; selected: boolean
}) {
  // A target in the lamp's own frame follows placement, rotation and animation.
  const target = useMemo(() => {
    const node = new THREE.Object3D()
    node.position.z = -1
    return node
  }, [])
  const light = item.illumination
  if (!light) return null
  return <group rotation={[THREE.MathUtils.degToRad(light.tilt - 90), 0, 0]}>
    <primitive object={target} />
    {enabled && <>
      {light.type === 'point' && <pointLight color={item.color} intensity={light.intensity} distance={light.range} />}
      {light.type === 'sun' && <directionalLight color={item.color} intensity={light.intensity} target={target} />}
      {light.type === 'spot' && <spotLight color={item.color} intensity={light.intensity} distance={light.range}
        angle={THREE.MathUtils.degToRad(light.beam_angle / 2)} penumbra={.25} target={target} />}
      {light.type === 'area' && <Suspense fallback={null}><AreaLight item={item} light={light} /></Suspense>}
    </>}
    {showHandle && <group name="Light handle" userData={{ isLightHandle: true }}>
      <mesh><octahedronGeometry args={[.16]} /><meshBasicMaterial color={selected ? '#4cc9ff' : '#ffce69'} wireframe /></mesh>
      {selected && light.type !== 'point' && <mesh position={[0, 0, -.3]} rotation={[-Math.PI/2, 0, 0]}>
        <coneGeometry args={[.1, .4, 8]} /><meshBasicMaterial color="#4cc9ff" wireframe />
      </mesh>}
    </group>}
  </group>
}
