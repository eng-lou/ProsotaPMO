import { useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Box3, Group, Mesh, OrthographicCamera, Vector3, type Matrix4 } from 'three'
import { previewBarLines } from './constructionGeometry'
import { SafeCanvas } from './SafeCanvas'

function PreviewModel({ scene, fit }: { scene: Group; fit: number }) {
  const { camera, size, invalidate } = useThree()
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const { bounds, lines } = useMemo(() => {
    scene.updateWorldMatrix(true, true)
    const bounds = new Box3().setFromObject(scene)
    const lines: { id: string; positions: Float32Array; matrix: Matrix4 }[] = []
    scene.traverse(node => {
      if (!(node instanceof Mesh)) return
      const positions = previewBarLines.get(node.geometry)
      if (positions) lines.push({ id: node.uuid, positions, matrix: node.matrixWorld.clone() })
    })
    return { bounds, lines }
  }, [scene])

  useLayoutEffect(() => {
    const orbit = controls.current
    if (!(camera instanceof OrthographicCamera) || !orbit || !size.width || !size.height) return
    const center = bounds.getCenter(new Vector3())
    const span = Math.max(bounds.getSize(new Vector3()).length(), .1)
    const direction = new Vector3(.65, .55, 1).normalize()
    camera.position.copy(center).addScaledVector(direction, span * 2)
    camera.lookAt(center)
    camera.near = .001
    camera.far = span * 8
    camera.updateMatrixWorld()
    // Fit the projected selection in both dimensions, including offset hosts.
    let halfWidth = 0, halfHeight = 0
    const point = new Vector3()
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          point.set(x,y,z).applyMatrix4(camera.matrixWorldInverse)
          halfWidth = Math.max(halfWidth, Math.abs(point.x))
          halfHeight = Math.max(halfHeight, Math.abs(point.y))
        }
    camera.zoom = .9 * Math.min(size.width / (2 * halfWidth || 1), size.height / (2 * halfHeight || 1))
    camera.updateProjectionMatrix()
    orbit.target.copy(center)
    orbit.update()
    invalidate()
  }, [bounds, camera, fit, invalidate, size.width, size.height])

  return <>
    <primitive object={scene} dispose={null}/>
    {lines.map(line => <lineSegments key={line.id} matrix={line.matrix} matrixAutoUpdate={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[line.positions, 3]}/></bufferGeometry>
      <lineBasicMaterial color="#303a46" toneMapped={false}/>
    </lineSegments>)}
    <OrbitControls ref={controls} makeDefault/>
  </>
}

export function ConstructionPreviewView({ scene, label }: { scene: Group; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [fit, setFit] = useState(0)
  const viewer = <SafeCanvas orthographic frameloop="demand" dpr={1} camera={{ position: [6,5,7] }}>
    <color attach="background" args={['#edf2f6']}/>
    <hemisphereLight args={['#ffffff', '#afb9c4', 1.7]}/>
    <directionalLight position={[4,8,5]} intensity={2}/>
    <PreviewModel scene={scene} fit={fit}/>
  </SafeCanvas>
  const fitButton = <button type="button" className="rounded border px-2 py-1 dark:border-prosota-line" onClick={() => setFit(n => n + 1)}>Fit view</button>
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      <strong>Preview</strong>
      <div className="flex gap-1">{fitButton}<button type="button" className="rounded border px-2 py-1 dark:border-prosota-line"
        onClick={() => { dialog.current?.showModal(); setExpanded(true) }}>Expand preview</button></div>
    </div>
    <div className="h-64 overflow-hidden rounded border border-slate-300" aria-label={label+' preview'}>{!expanded && viewer}</div>
    <dialog ref={dialog} aria-label={label+' expanded preview'} onClose={() => setExpanded(false)}
      className="m-auto w-[92vw] max-w-6xl rounded border bg-white p-3 text-slate-900 backdrop:bg-black/50 dark:border-prosota-line dark:bg-prosota-panel dark:text-slate-100">
      {expanded && <><div className="mb-2 flex items-center justify-between gap-2"><strong>{label}</strong>
        <div className="flex gap-2">{fitButton}<button autoFocus type="button" className="rounded border px-2 py-1 dark:border-prosota-line"
          onClick={() => dialog.current?.close()}>Close preview</button></div></div>
        <div className="h-[72vh] overflow-hidden rounded">{viewer}</div></>}
    </dialog>
    <p className="text-xs">Drag to rotate. Scroll or pinch to zoom.</p>
  </div>
}
