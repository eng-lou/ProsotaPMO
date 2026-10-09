import * as THREE from 'three'
import type { IfcModelHandle } from './ifcModel'
import type { ClashSnapshotElement, GeometryResult } from './clashGeometry'

export interface ClashElementRef { sourceKind: 'ifc' | 'mesh'; ref: string; label: string; metadata?: { model: string; type: string; level: string } }
const storeyMaps = new WeakMap<IfcModelHandle, Map<number, { name: string }>>()
export interface ResolvedClashElement { ref: ClashElementRef; meshes: THREE.Mesh[] }
export interface ClashPairResult { elementA: ClashElementRef; elementB: ClashElementRef; distanceMm: number | null }
export interface ClashSceneObject { id: string; kind: 'ifc' | 'mesh'; name: string; object: THREE.Object3D }
export const clashKey = (r: ClashElementRef) => `${r.sourceKind}:${r.ref}`
export function decodeClashRef(ref: string): { model?: string; ref: string } {
  if (ref.startsWith('@model:')) {
    try { const [model, original] = JSON.parse(ref.slice(7)); return { model, ref: original } } catch { /* legacy ref */ }
  }
  return { ref }
}
function encodeRef(model: string, ref: string) {
  const value = '@model:' + JSON.stringify([model, ref])
  if (value.length > 300) throw new Error('Model/element identifier exceeds 300 characters. Shorten the model filename.')
  return value
}
export function effectivelyVisible(mesh: THREE.Object3D): boolean {
  let object: THREE.Object3D | null = mesh
  while (object) { if (!object.visible) return false; object = object.parent }
  if (mesh instanceof THREE.Mesh) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.every(m => !m.visible || m.opacity === 0)) return false
  }
  return true
}

export async function resolveMembersToElements(
  members: { source_kind: 'ifc' | 'mesh'; element_ref: string; element_label: string }[],
  sceneObjects: ClashSceneObject[], ifcHandles: IfcModelHandle[], qualifyRefs = false,
): Promise<ResolvedClashElement[]> {
  const resolved: ResolvedClashElement[] = []
  const ifc = members.some(m => m.source_kind === 'ifc') ? await import('./ifcModel') : null
  for (const member of members) {
    const decoded = decodeClashRef(member.element_ref)
    const meshes: THREE.Mesh[] = []
    let ref = member.element_ref
    let metadata = { model: decoded.model ?? decoded.ref, type: 'Mesh', level: '' }
    if (member.source_kind === 'mesh') {
      const matches = sceneObjects.filter(o => o.kind === 'mesh' && o.name === decoded.ref)
      if (matches.length > 1) throw new Error(`Ambiguous mesh name: ${decoded.ref}. Rename duplicate models before testing.`)
      matches[0]?.object.traverse(child => { if (child instanceof THREE.Mesh) meshes.push(child) })
    } else if (ifc) {
      const matches = ifcHandles.flatMap(handle => {
        const scene = sceneObjects.find(o => o.object === handle.object)
        if (!scene || (decoded.model && scene.name !== decoded.model)) return []
        const id = ifc.getExpressIdFromGuid(handle, decoded.ref)
        return id === undefined ? [] : [{ handle, id, name: scene.name }]
      })
      if (matches.length > 1) throw new Error(`Element ${member.element_label} appears in multiple loaded models. Use an unambiguous collection before testing.`)
      if (matches.length === 1) {
        const { handle, id, name } = matches[0]
        const mesh = ifc.ensureMaterialized(handle.object, id)
        if (mesh) meshes.push(mesh)
        ref = qualifyRefs ? encodeRef(name, decoded.ref) : decoded.ref
        if (qualifyRefs) {
          let levels = storeyMaps.get(handle)
          if (!levels) { levels = await ifc.buildElementStoreyMap(handle); storeyMaps.set(handle, levels) }
          metadata = { model: name, type: ifc.getElementTypeName(handle, id), level: levels.get(id)?.name ?? '' }
        }
      }
    }
    if (meshes.length) resolved.push({ ref: { sourceKind: member.source_kind, ref, label: member.element_label, metadata }, meshes })
  }
  return resolved
}

export function captureClashGeometry(elements: ResolvedClashElement[]): ClashSnapshotElement[] {
  // Capture all world transforms/vertices synchronously before yielding to the worker.
  // Later animation or camera interaction cannot change the geometry being tested.
  return [...new Map(elements.map(el => [clashKey(el.ref), el])).values()].map(el => ({
    key: clashKey(el.ref), meshes: el.meshes.map(mesh => {
      if (mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh) throw new Error('Skinned/instanced mesh imports must be converted to static geometry before clash testing.')
      mesh.updateWorldMatrix(true, false)
      const position = mesh.geometry.getAttribute('position')
      if (!position) throw new Error(`No geometry for ${el.ref.label}`)
      const positions: number[] = []
      const v = new THREE.Vector3()
      for (let i = 0; i < position.count; i++) { v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld); positions.push(v.x, v.y, v.z) }
      const index = mesh.geometry.getIndex()
      const indices = index ? Array.from(index.array) : Array.from({ length: position.count }, (_, i) => i)
      if (indices.length % 3 || positions.some(n => !Number.isFinite(n))) throw new Error(`Invalid triangle geometry for ${el.ref.label}`)
      return { positions, indices }
    }),
  }))
}

export function computeClashesInWorker(elements: ClashSnapshotElement[], aKeys: string[], bKeys: string[], kind: 'hard' | 'clearance', tolerance: number, metresPerUnit: number, signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<GeometryResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
    const worker = new Worker(new URL('./clash.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Cancelled; previous results preserved', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = e => { cleanup(); reject(new Error(e.message || 'Clash worker failed')) }
    worker.onmessage = ({ data }) => {
      if (data.progress) onProgress?.(data.progress.done, data.progress.total)
      else { cleanup(); if (data.error) reject(new Error(data.error)); else resolve(data.result) }
    }
    worker.postMessage({ elements, aKeys, bKeys, kind, tolerance, metresPerUnit })
  })
}

// Compatibility for other local callers; the UI uses the snapshot directly to save report evidence.
export async function findClashes(a: ResolvedClashElement[], b: ResolvedClashElement[], kind: 'hard' | 'clearance', tolerance: number, _selfTest: boolean, progress?: (done: number, total: number) => void): Promise<ClashPairResult[]> {
  const refs = new Map([...a, ...b].map(el => [clashKey(el.ref), el.ref]))
  const { hits } = await computeClashesInWorker(captureClashGeometry([...a, ...b]), a.map(el => clashKey(el.ref)), b.map(el => clashKey(el.ref)), kind, tolerance, 1, undefined, progress)
  return hits.map(h => ({ elementA: refs.get(h.a)!, elementB: refs.get(h.b)!, distanceMm: h.distanceMm }))
}
