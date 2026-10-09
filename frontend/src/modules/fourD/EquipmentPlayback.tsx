import type { EquipmentVisualState } from './EquipmentVisualEditor'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { bindEquipment, equipmentNodes, type EquipmentRig } from './equipmentRig'

export function EquipmentPlayback({ rigs, objects, dateRef, preview, onError, visual }: {
  visual?: EquipmentVisualState | null
  rigs: EquipmentRig[]; objects: { name: string; kind: string; object: THREE.Object3D }[]
  dateRef: React.MutableRefObject<Date | null>
  preview: { model: string; values: Record<string, number>; time: number | null } | null
  onError: (error: string | null) => void
}) {
  const bindings = useRef<{ rig: EquipmentRig; runtime: ReturnType<typeof bindEquipment> }[]>([])
  const last = useRef<{ time: number | null; preview: typeof preview } | null>(null)
  const lastVisual = useRef<typeof visual>(undefined)
  const { invalidate } = useThree()
  useEffect(() => {
    const next: typeof bindings.current = []
    const errors: string[] = []
    for (const rig of rigs) {
      const candidates = objects.filter(o => o.name === rig.model_ref && o.kind === 'mesh')
      if (!candidates.length) continue
      if (candidates.length !== 1) { errors.push(`Ambiguous equipment model: ${rig.model_ref}`); continue }
      if (candidates[0].object.animations.length) { errors.push(`${rig.name}: disable/remove embedded animation before using equipment controls`); continue }
      try { next.push({ rig, runtime: bindEquipment(candidates[0].object, rig.definition) }) }
      catch (e) { errors.push(`${rig.name}: ${(e as Error).message}`) }
    }
    bindings.current = next; last.current = null; onError(errors.join('; ') || null); invalidate()
    return () => { next.forEach(b => b.runtime.restore()); bindings.current = [] }
  }, [rigs, objects, onError, invalidate])
  useEffect(() => { invalidate() }, [preview, visual, invalidate])
  useFrame(() => {
    const time = dateRef.current?.getTime() ?? null
    if (last.current?.time === time && last.current.preview === preview && lastVisual.current === visual) return
    lastVisual.current = visual
    last.current = { time, preview }
    for (const { rig, runtime } of bindings.current) {
      if (visual?.model === rig.model_ref) runtime.evaluate(null, Object.fromEntries(rig.definition.controls.map(c=>[c.id,c.rest])), visual.joint && visual.mode==='pose' ? {[visual.joint]:visual.amount} : {})
      else runtime.evaluate(time, preview?.model === rig.model_ref && preview.time === time ? preview.values : {})
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
  const observedModels = useRef(new Set<string>())
  useEffect(() => {
    pairs.current = []
    for (const rig of rigs) observedModels.current.add(rig.model_ref)
    // Keep mirroring previously rigged imports after removal so restored source
    // rest poses also reach their comparison clones.
    for (const model of observedModels.current) {
      const source = sources.find(o => o.name === model), target = targets.find(o => o.name === model)
      if (!source || !target) continue
      const targetNodes = equipmentNodes(target.object)
      for (const [key, node] of equipmentNodes(source.object)) {
        const other = targetNodes.get(key)
        if (key && other) pairs.current.push([node, other])
      }
    }
  }, [rigs, sources, targets])
  useFrame(() => {
    for (const [source, target] of pairs.current) {
      target.position.copy(source.position); target.quaternion.copy(source.quaternion); target.scale.copy(source.scale); target.updateMatrix()
    }
  })
  return null
}
