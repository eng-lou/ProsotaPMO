import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { equipmentNodes, type Vec3 } from './equipmentRig'

export interface EquipmentVisualState {
  rotation?: Vec3; label?: string; beginPivot: () => void; rotatePivot: (rotation: Vec3) => void
  model: string; selected: string[]; hidden: string[]; isolated: string[] | null
  mode: 'select' | 'pivot' | 'pose' | 'parent'
  joint?: string; pivot?: Vec3; axis?: Vec3; kind?: 'hinge' | 'slide'; amount: number
  pick: (path: string, add: boolean, point: Vec3) => void
  movePivot: (point: Vec3) => void; pose: (amount: number) => void
}

export function EquipmentVisualEditor({ state, objects, transformMode = 'translate', transformSpace = 'world' }: { transformMode?: 'translate'|'rotate'|'scale'; transformSpace?: 'local'|'world'; state: EquipmentVisualState | null; objects: {name: string; object: THREE.Object3D}[] }) {
  const { gl, camera, invalidate } = useThree()
  const root = objects.find(o => o.name === state?.model)?.object
  const nodes = useMemo(() => root ? equipmentNodes(root) : new Map<string, THREE.Object3D>(), [root])
  const marker = useMemo(() => new THREE.Group(), [])
  const dragging = useRef(false)
  const current = useRef(state); current.current = state
  const baseQuaternion = useRef(new THREE.Quaternion())
  const helpers = useMemo(() => state?.selected.flatMap(key => {
    const node = nodes.get(key); return node ? [new THREE.BoxHelper(node, 0xffb000)] : []
  }) ?? [], [nodes, state?.selected])
  useEffect(() => () => helpers.forEach(h => { h.geometry.dispose(); (h.material as THREE.Material).dispose() }), [helpers])
  useEffect(() => {
    if (!state || !root) return
    const canvas = gl.domElement
    const keys = new Map([...nodes].map(([key, node]) => [node, key]))
    let down: [number, number] | null = null
    const pointerDown = (e: PointerEvent) => { down = [e.clientX, e.clientY] }
    const click = (e: MouseEvent) => {
      if (!down || Math.hypot(e.clientX-down[0],e.clientY-down[1]) > 5 || dragging.current || e.button !== 0) return
      const cfg = current.current; if (!cfg) return
      if (cfg.mode === 'pose') { e.stopImmediatePropagation(); return }
      const rect = canvas.getBoundingClientRect(), ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1, -(e.clientY-rect.top)/rect.height*2+1), camera)
      const hit = ray.intersectObject(root,true).find(h => {
        if (!(h.object as THREE.Mesh).isMesh) return false
        let n: THREE.Object3D | null = h.object
        while(n) { if (!n.visible) return false; n=n.parent }
        return true
      })
      // Prevent normal whole-model selection while editing equipment parts.
      e.stopImmediatePropagation()
      if (!hit) return
      const key=keys.get(hit.object); if (!key) return
      const point=root.worldToLocal(hit.point.clone()).toArray() as Vec3
      cfg.pick(key,e.ctrlKey || e.metaKey,point); invalidate()
    }
    canvas.addEventListener('pointerdown',pointerDown,true)
    canvas.addEventListener('click',click,true)
    return () => { canvas.removeEventListener('pointerdown',pointerDown,true); canvas.removeEventListener('click',click,true) }
  }, [!!state, root, nodes, gl, camera, invalidate])
  useEffect(() => {
    if (!state || !root) return
    const originals = new Map([...nodes].map(([key,n])=>[key,n.visible]))
    return () => { originals.forEach((visible,key)=>{ const n=nodes.get(key); if(n) n.visible=visible }); invalidate() }
  }, [!!state, root, nodes, invalidate])
  useFrame(() => {
    const cfg=current.current
    if (!cfg || !root) return
    for (const [key,node] of nodes) {
      if (!(node as THREE.Mesh).isMesh) continue
      const contains = (a: string) => key===a || key.startsWith(a+'/')
      node.visible = !cfg.hidden.some(contains) && (!cfg.isolated || cfg.isolated.some(contains))
    }
    helpers.forEach(h=>h.update())
    if (!dragging.current && cfg.pivot) {
      root.updateWorldMatrix(true,false)
      marker.position.copy(root.localToWorld(new THREE.Vector3(...cfg.pivot)))
      root.getWorldQuaternion(baseQuaternion.current)
      baseQuaternion.current.multiply(cfg.rotation ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...cfg.rotation)) : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(...(cfg.axis ?? [0,0,1])).normalize()))
      marker.quaternion.copy(baseQuaternion.current)
      if(cfg.mode==='pose' && cfg.kind==='hinge') marker.rotateZ(THREE.MathUtils.degToRad(cfg.amount))
      if(cfg.mode==='pose' && cfg.kind==='slide') marker.position.copy(root.localToWorld(new THREE.Vector3(...cfg.pivot).add(new THREE.Vector3(...(cfg.axis ?? [0,0,1])).normalize().multiplyScalar(cfg.amount))))
      marker.updateMatrixWorld()
    }
  })
  if (!state || !root) return null
  return <>
    {helpers.map(h=><primitive key={h.uuid} object={h} />)}
    {state.pivot && <><primitive object={marker} />
      {(state.mode==='pivot' || state.mode==='pose') && <TransformControls object={marker}
        mode={state.mode==='pose' ? (state.kind==='hinge' ? 'rotate' : 'translate') : (transformMode==='rotate' ? 'rotate' : 'translate')}
        space={state.mode==='pose' ? 'local' : transformSpace} showX={state.mode!=='pose'} showY={state.mode!=='pose'} showZ
        onMouseDown={()=>{dragging.current=true}}
        onObjectChange={()=>{
          const cfg=current.current
          if (!dragging.current || !cfg || !root) return
          if (cfg.mode==='pivot') {
            if(transformMode==='rotate') {
              const local=root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(marker.quaternion)
              const e=new THREE.Euler().setFromQuaternion(local,'XYZ');cfg.rotatePivot([e.x,e.y,e.z])
            } else cfg.movePivot(root.worldToLocal(marker.position.clone()).toArray() as Vec3)
          }
          else if (cfg.kind==='hinge') {
            const q=baseQuaternion.current.clone().invert().multiply(marker.quaternion)
            cfg.pose(THREE.MathUtils.radToDeg(2*Math.atan2(q.z,q.w)))
          } else {
            const point=root.worldToLocal(marker.position.clone()).sub(new THREE.Vector3(...cfg.pivot!))
            cfg.pose(point.dot(new THREE.Vector3(...cfg.axis!).normalize()))
          }
        }}
        onMouseUp={()=>{
          const cfg=current.current
          if(cfg && root) {
            if (cfg.mode==='pivot') {
            if(transformMode==='rotate') {
              const local=root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(marker.quaternion)
              const e=new THREE.Euler().setFromQuaternion(local,'XYZ');cfg.rotatePivot([e.x,e.y,e.z])
            } else cfg.movePivot(root.worldToLocal(marker.position.clone()).toArray() as Vec3)
          }
            else if(cfg.kind==='hinge') {
              const q=baseQuaternion.current.clone().invert().multiply(marker.quaternion)
              cfg.pose(THREE.MathUtils.radToDeg(2*Math.atan2(q.z,q.w)))
            } else {
              const point=root.worldToLocal(marker.position.clone()).sub(new THREE.Vector3(...cfg.pivot!))
              cfg.pose(point.dot(new THREE.Vector3(...cfg.axis!).normalize()))
            }
          }
          setTimeout(()=>{dragging.current=false;invalidate()},0)
        }} />}
    </>}
  </>
}
