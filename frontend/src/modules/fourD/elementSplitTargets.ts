import * as THREE from 'three'
import type { ElementSplit } from './elementSplits'
import type { IfcModelHandle } from './ifcModel'
import { getOriginalGeometry, getOriginalMaterialSlots } from './elementBaseline'
import { ensureMaterialized, finalizeIndividualMesh, getMeshIndex, removeElementsFromModel } from './elementBatching'
import { buildSplitElementRef, splitTargetMapsByHandle, type SplitTargetMaps } from './splitElementRefs'
import { levelSliceGeometry } from './levelSliceGeometry'
export { getSplitExpressId, getSplitElementRef } from './splitElementRefs'

interface Piece {
  id: number
  signature: string
  source: THREE.Mesh
}
interface SplitState extends SplitTargetMaps {
  nextId: number
  pieces: Map<string, Piece>
  parents: Set<THREE.Mesh>
  excluded: Set<string>
}
const states = new WeakMap<IfcModelHandle, SplitState>()

function stateFor(handle: IfcModelHandle) {
  let state = states.get(handle)
  if (!state) {
    state = { nextId: 1_000_000_000, pieces: new Map(), parents: new Set(), excluded: new Set(),
      refToExpressId: new Map(), expressIdToRef: new Map() }
    states.set(handle, state)
    splitTargetMapsByHandle.set(handle, state)
  }
  return state
}

export function splitExclusions(handle: IfcModelHandle) { return stateFor(handle).excluded }

function makePiece(root: THREE.Group, sources: THREE.Mesh[], axis: 'y' | 'z', low: number, high: number, ref: string, id: number) {
  const bounds = new THREE.Box3()
  const inverseRoot = root.matrixWorld.clone().invert()
  const meshes: THREE.Mesh[] = []
  for (const source of sources) {
    const geometry = levelSliceGeometry(getOriginalGeometry(source), source.matrixWorld, axis, low, high)
    if (!geometry) continue
    const relative = new THREE.Matrix4().multiplyMatrices(inverseRoot, source.matrixWorld)
    geometry.applyMatrix4(relative)
    if (relative.determinant() < 0) {
      const indices = geometry.index ? Array.from(geometry.index.array) : Array.from({length: geometry.getAttribute('position').count}, (_, i) => i)
      for (let i = 0; i + 2 < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
      geometry.setIndex(indices)
    }
    geometry.computeBoundingBox()
    bounds.union(geometry.boundingBox!)
    const material = (source.userData.standardMaterial ?? source.material).clone() as THREE.MeshStandardMaterial
    const original = getOriginalMaterialSlots(source)[0]
    if (original) {
      material.color.copy(original.color)
      material.opacity = original.opacity
      material.transparent = original.transparent
      material.depthWrite = original.depthWrite
    }
    material.clippingPlanes = null
    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData.isSplitClone = true
    mesh.userData.splitElementRef = ref
    mesh.castShadow = source.castShadow
    mesh.receiveShadow = source.receiveShadow
    meshes.push(mesh)
  }
  const center = bounds.getCenter(new THREE.Vector3())
  const placement = new THREE.Matrix4().makeTranslation(center)
  for (const mesh of meshes) {
    mesh.geometry.translate(-center.x, -center.y, -center.z)
    finalizeIndividualMesh(mesh, id, placement, root)
  }
  return meshes.length > 0
}

// Keep existing edit targets and IDs when a different wall is split or a second IFC loads.
export function syncLevelPieces(handle: IfcModelHandle, splits: ElementSplit[], axis: 'y' | 'z', metres: number,
  parentId: (ref: string) => number | undefined) {
  const state = stateFor(handle)
  const root = handle.object
  const index = getMeshIndex(root)
  const wanted = new Set<string>()
  const parents = new Set<THREE.Mesh>()
  const created = new Set<string>()
  for (const split of splits) {
    const expressId = parentId(split.element_ref)
    if (expressId === undefined || !ensureMaterialized(root, expressId)) continue
    const sources = index.get(expressId)!
    for (const source of sources) {
      source.updateWorldMatrix(true, false)
      source.userData.isSplitAway = true
      source.userData.baseVisible = false
      source.visible = false
      parents.add(source)
    }
    const cuts = [...split.cut_elevations_m].sort((a,b) => a-b).map(value => value / metres)
    for (let i = 0; i <= cuts.length; i++) {
      const ref = buildSplitElementRef(split.element_ref, i)
      const low = cuts[i-1] ?? -Infinity, high = cuts[i] ?? Infinity
      const signature = [axis, low, high].join('|')
      let piece = state.pieces.get(ref)
      const changed = !piece || piece.signature !== signature || piece.source !== sources[0]
      if (!piece) {
        piece = { id: state.nextId++, signature, source: sources[0] }
        state.pieces.set(ref, piece)
      }
      state.refToExpressId.set(ref, piece.id)
      state.expressIdToRef.set(piece.id, ref)
      wanted.add(ref)
      if (changed && index.has(piece.id)) removeElementsFromModel(root, [piece.id])
      piece.signature = signature
      piece.source = sources[0]
      if (state.excluded.has(ref) || state.excluded.has(String(piece.id))) continue
      if (!index.has(piece.id) && makePiece(root, sources, axis, low, high, ref, piece.id)) created.add(ref)
    }
  }
  for (const [ref, piece] of state.pieces) {
    if (wanted.has(ref)) continue
    removeElementsFromModel(root, [piece.id])
    state.pieces.delete(ref)
    state.refToExpressId.delete(ref)
    state.expressIdToRef.delete(piece.id)
  }
  for (const mesh of state.parents) {
    if (!parents.has(mesh)) {
      delete mesh.userData.isSplitAway
      mesh.userData.baseVisible = true
      mesh.visible = true
    }
  }
  state.parents = parents
  return created
}

export async function regenerateSplitTargets(handle: IfcModelHandle, splits: ElementSplit[], axis: 'y' | 'z', current = () => true) {
  if (!splits.length) return syncLevelPieces(handle, [], axis, 1, () => undefined)
  const ifc = await import('./ifcModel')
  if (!current()) return new Set<string>()
  return syncLevelPieces(handle, splits, axis, ifc.getModelLengthUnitToMetres(handle), ref => ifc.getExpressIdFromGuid(handle, ref))
}
