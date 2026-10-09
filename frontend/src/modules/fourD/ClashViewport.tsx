import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { ClashSnapshotElement } from './clashGeometry'
import type { ClashResult } from './clashTests'

function Part({ data, color, ghost }: { data: ClashSnapshotElement['meshes'][number]; color: string; ghost: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3))
    g.setIndex(data.indices); g.computeVertexNormals(); return g
  }, [data])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry}><meshStandardMaterial color={color} side={THREE.DoubleSide} transparent={ghost} opacity={ghost ? .25 : .85} depthWrite={!ghost} /></mesh>
}
export interface ClashViewpoint { eye: [number, number, number]; target: [number, number, number]; up: [number, number, number] }
function Scene({ elements, a, b, context, reset, point, viewpoint, onViewpoint, upAxis }: { elements: ClashSnapshotElement[]; a: string; b: string; context: boolean; reset: number; upAxis: 'y' | 'z'; point?: [number, number, number] | null; viewpoint?: ClashViewpoint; onViewpoint?: (v: ClashViewpoint) => void }) {
  const controls = useRef<any>(null)
  const { camera, invalidate } = useThree()
  useEffect(() => {
    const box = new THREE.Box3()
    for (const e of elements.filter(e => context || e.key === a || e.key === b)) for (const mesh of e.meshes) {
      for (let i = 0; i < mesh.positions.length; i += 3) box.expandByPoint(new THREE.Vector3(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]))
    }
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3()), size = Math.max(box.getSize(new THREE.Vector3()).length(), .01)
    camera.position.copy(center).add((upAxis === 'z' ? new THREE.Vector3(1, -1, .8) : new THREE.Vector3(1, .8, 1)).normalize().multiplyScalar(size * 1.5))
    camera.near = Math.max(.00001, size / 10000); camera.far = size * 100; camera.updateProjectionMatrix()
    camera.up.set(0, upAxis === 'y' ? 1 : 0, upAxis === 'z' ? 1 : 0)
    if (viewpoint && reset === 0 && !context) { camera.position.fromArray(viewpoint.eye); camera.up.fromArray(viewpoint.up); center.fromArray(viewpoint.target) }
    controls.current?.target.copy(center); controls.current?.update(); invalidate()
  }, [elements, a, b, camera, invalidate, reset, viewpoint, upAxis, context])
  return <>
    <ambientLight intensity={1.5} /><directionalLight position={[10, 20, 10]} intensity={2} />
    {elements.filter(e => context || e.key === a || e.key === b).map(e => e.meshes.map((m, i) => <Part key={`${e.key}:${i}`} data={m} color={e.key === a ? '#38bdf8' : e.key === b ? '#fb923c' : '#94a3b8'} ghost={e.key !== a && e.key !== b} />))}
    {point && <mesh position={point}><sphereGeometry args={[Math.max(.005, camera.position.distanceTo(new THREE.Vector3(...point)) / 150), 12, 12]} /><meshBasicMaterial color="#f43f5e" depthTest={false} /></mesh>}
    <OrbitControls ref={controls} makeDefault onEnd={() => { if (controls.current) onViewpoint?.({ eye: camera.position.toArray() as [number, number, number], target: controls.current.target.toArray(), up: camera.up.toArray() as [number, number, number] }) }} />
  </>
}
export function ClashViewport({ geometry, result, viewpoint, onViewpoint, upAxis = 'z', backgroundColor = '#e5e7eb' }: { geometry: ClashSnapshotElement[]; result: ClashResult; upAxis?: 'y' | 'z'; backgroundColor?: string; viewpoint?: ClashViewpoint; onViewpoint?: (v: ClashViewpoint) => void }) {
  const [context, setContext] = useState(false), [reset, setReset] = useState(0)
  const extraCount = geometry.filter(e => e.key !== `${result.element_a_source_kind}:${result.element_a_ref}` && e.key !== `${result.element_b_source_kind}:${result.element_b_ref}`).length
  return <div>
    <div className="flex gap-3 items-center text-xs py-2"><span style={{ color: '#38bdf8' }}>A: {result.element_a_label}</span><span style={{ color: '#fb923c' }}>B: {result.element_b_label}</span>
      <button onClick={() => { setContext(false); setReset(n => n + 1) }}>Frame pair</button>{extraCount > 0 ? <label><input type="checkbox" checked={context} onChange={e => setContext(e.target.checked)} /> Show included context ({extraCount} elements)</label> : <span>No additional context geometry included.</span>}</div>
    <div style={{ height: '48vh', minHeight: 280, background: backgroundColor, borderRadius: 8 }}>
      <Canvas key={upAxis} camera={{ position: [10, 10, 10], up: upAxis === 'z' ? [0, 0, 1] : [0, 1, 0], fov: 45 }} frameloop="demand" gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={[backgroundColor]} />
        <Scene upAxis={upAxis} elements={geometry} a={`${result.element_a_source_kind}:${result.element_a_ref}`} b={`${result.element_b_source_kind}:${result.element_b_ref}`} context={context} reset={reset} point={result.clash_point} viewpoint={viewpoint} onViewpoint={onViewpoint} />
      </Canvas>
    </div><p className="text-xs py-1">Drag to orbit · Scroll to zoom · Right-drag to pan. Only included geometry is available. Red marker: approximate overlap centre, or nearest surface point for clearance.</p>
  </div>
}
