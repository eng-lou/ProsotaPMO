import type { EquipmentVisualState } from './EquipmentVisualEditor'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { bindEquipment, equipmentNodes, type EquipmentRig } from './equipmentRig'
import { createSoilPlayback } from './soilPlayback'
import type { SiteLayerState } from './SiteSceneLayer'
import type { Path } from './paths'
import { buildPathCurve } from './pathCurve'
import { applySitePath } from './sitePathMotion'

export function EquipmentPlayback({ rigs, objects, dateRef, preview, onError, visual, siteScene, paths=[], daysPerSecond=1, rendering=false }: {
  siteScene?: SiteLayerState; paths?: Path[]; daysPerSecond?: number; rendering?: boolean
  visual?: EquipmentVisualState | null
  rigs: EquipmentRig[]; objects: { name: string; kind: string; object: THREE.Object3D }[]
  dateRef: React.MutableRefObject<Date | null>
  preview: { model: string; values: Record<string, number>; time: number | null } | null
  onError: (error: string | null) => void
}) {
  const bindings = useRef<{ rig: EquipmentRig; runtime: ReturnType<typeof bindEquipment>; root:THREE.Object3D; bucket?:THREE.Object3D; soil?:ReturnType<typeof createSoilPlayback> }[]>([])
  const last = useRef<{ time: number | null; preview: typeof preview } | null>(null)
  const lastVisual = useRef<typeof visual>(undefined)
  const { invalidate, scene } = useThree()
  useEffect(() => {
    const next: typeof bindings.current = []
    const errors: string[] = []
    for (const rig of rigs) {
      const candidates = objects.filter(o => o.name === rig.model_ref && o.kind === 'mesh')
      if (!candidates.length) continue
      if (candidates.length !== 1) { errors.push(`Ambiguous equipment model: ${rig.model_ref}`); continue }
      if (candidates[0].object.animations.length) { errors.push(`${rig.name}: disable/remove embedded animation before using equipment controls`); continue }
      try {
        const root=candidates[0].object, runtime=bindEquipment(root,rig.definition)
        const binding:typeof next[number]={rig,runtime,root};next.push(binding)
        const s=rig.definition.soil
        if(s?.enabled){
          const clone=root.clone(true), sample=bindEquipment(clone,rig.definition), bucket=equipmentNodes(clone).get(s.bucket_node)!
          binding.bucket=equipmentNodes(root).get(s.bucket_node)
          root.updateWorldMatrix(true,true)
          const base=root.matrixWorld.clone(), item=siteScene?.items.find(i=>'site:'+i.id===rig.model_ref)
          const sourcePath=paths.find(p=>p.id===item?.path_motion?.path_id)
          const curve=sourcePath?buildPathCurve(sourcePath.points,sourcePath.closed,sourcePath.curve_mode):null
          const parent=siteScene?.objects?.find(o=>o.id===rig.model_ref)?.object.parent
          if(curve&&parent){parent.updateWorldMatrix(true,false);base.premultiply(parent.matrixWorld.clone().invert())}
          const pathRoot=new THREE.Group();clone.matrixAutoUpdate=false
          try { binding.soil=createSoilPlayback(s,time=>{
            clone.matrix.copy(base)
            if(curve&&item?.path_motion){applySitePath(pathRoot,curve,item.path_motion,(time-Date.parse(item.path_motion.start))/(86400000*daysPerSecond),item.up_axis,new THREE.Vector3(item.position.x,item.position.y,item.position.z),daysPerSecond);clone.matrix.premultiply(pathRoot.matrix)}
            sample.evaluate(time);bucket.updateWorldMatrix(true,false);return bucket.matrixWorld.clone()
          },bucket) } finally { sample.dispose() }
          scene.add(binding.soil.group)
        }
      }
      catch (e) { errors.push(`${rig.name}: ${(e as Error).message}`) }
    }
    bindings.current = next; last.current = null; onError(errors.join('; ') || null); invalidate()
    return () => { next.forEach(b => {b.runtime.dispose();delete b.root.userData.soilStatus;if(b.soil){scene.remove(b.soil.group);b.soil.dispose()}}); bindings.current = [] }
  }, [rigs, objects, onError, invalidate, scene, siteScene?.items, paths, daysPerSecond])
  useEffect(() => { invalidate() }, [preview, visual, invalidate])
  useFrame(() => {
    const time = dateRef.current?.getTime() ?? null
    const changed=last.current?.time !== time || last.current?.preview !== preview || lastVisual.current !== visual
    lastVisual.current = visual
    last.current = { time, preview }
    for (const { rig, runtime, root, bucket, soil } of bindings.current) {
      if(changed){
        if (visual?.model === rig.model_ref) runtime.evaluate(null, Object.fromEntries(rig.definition.controls.map(c=>[c.id,c.rest])), visual.joint && visual.mode==='pose' ? {[visual.joint]:visual.amount} : {})
        else runtime.evaluate(time, preview?.model === rig.model_ref && preview.time === time ? preview.values : {})
      }
      if(soil&&bucket){
        let visible=true;for(let n:THREE.Object3D|null=root;n;n=n.parent)if(!n.visible)visible=false
        soil.group.visible=visible
        bucket.updateWorldMatrix(true,false)
        const state=soil.update(time,bucket.matrixWorld,!!rig.definition.soil?.show_guide&&!rendering)
        root.userData.soilStatus={fill:state.fill,deposited:state.deposited,inAir:state.inAir}
      }
    }
  })
  return null
}

/** Comparison panes own cloned geometry; mirror internal poses, leaving their
 * independently evaluated schedule/root transforms untouched. */
export function EquipmentPoseMirror({ rigs, sources, targets }: {
  rigs: EquipmentRig[]
  sources: { name: string; object: THREE.Object3D }[]
  targets: { name: string; object: THREE.Object3D }[]
}) {
  const pairs = useRef<[THREE.Object3D, THREE.Object3D][]>([])
  const detailPairs = useRef<[THREE.Object3D, THREE.Object3D, boolean][]>([])
  const surfaces = useRef(new Map<THREE.Mesh, { original: THREE.BufferGeometry; copy: THREE.BufferGeometry; source: THREE.BufferGeometry; version: number }>())
  const observedModels = useRef(new Set<string>())
  useEffect(() => {
    pairs.current = []
    detailPairs.current = []
    for (const rig of rigs) observedModels.current.add(rig.model_ref)
    // Keep mirroring previously rigged imports after removal so restored source
    // rest poses also reach their comparison clones.
    for (const model of observedModels.current) {
      const source = sources.find(o => o.name === model), target = targets.find(o => o.name === model)
      if (!source || !target) continue
      const targetNodes = equipmentNodes(target.object)
      const detailPaths = new Set(rigs.find(r => r.model_ref === model)?.definition.motion_details?.map(d => d.node) ?? [])
      for (const [key, node] of equipmentNodes(source.object)) {
        const other = targetNodes.get(key)
        if (key && other) pairs.current.push([node, other])
        if (other && detailPaths.has(key)) detailPairs.current.push([node, other, other.visible])
      }
    }
    return () => {
      for (const [, target, visible] of detailPairs.current) target.visible = visible
      for (const [target, surface] of surfaces.current) { target.geometry = surface.original; surface.copy.dispose() }
      surfaces.current.clear()
    }
  }, [rigs, sources, targets])
  useFrame(() => {
    for (const [source, target, visible] of detailPairs.current) target.visible = visible && source.visible
    for (const [source, target] of pairs.current) {
      target.position.copy(source.position); target.quaternion.copy(source.quaternion); target.scale.copy(source.scale); target.updateMatrix()
      if ((source as THREE.Mesh).isMesh && (target as THREE.Mesh).isMesh) {
        const a = source as THREE.Mesh, b = target as THREE.Mesh
        let surface = surfaces.current.get(b)
        if (a.geometry.userData.prosotaFlexible) {
          if (!surface) {
            surface = { original: b.geometry, copy: a.geometry.clone(), source: a.geometry, version: -1 }
            surfaces.current.set(b, surface); b.geometry = surface.copy
          }
          const version = (a.geometry.getAttribute('position') as THREE.BufferAttribute).version
          if (surface.source !== a.geometry || surface.version !== version) {
            for (const name of ['position', 'normal', 'tangent']) {
              const src = a.geometry.getAttribute(name), dst = surface.copy.getAttribute(name)
              if (src && dst) { dst.array.set(src.array); dst.needsUpdate = true }
            }
            surface.copy.boundingBox = a.geometry.boundingBox?.clone() ?? null
            surface.copy.boundingSphere = a.geometry.boundingSphere?.clone() ?? null
            surface.source = a.geometry; surface.version = version
          }
        } else if (surface) { b.geometry = surface.original; surface.copy.dispose(); surfaces.current.delete(b) }
      }
    }
  })
  return null
}
