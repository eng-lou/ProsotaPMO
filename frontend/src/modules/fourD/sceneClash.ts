import * as THREE from 'three'
import { MeshBVH, computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'
import type { IfcModelHandle } from './ifcModel'

// Navisworks-style Clash Detective (2026-07-12, per Maro). Nothing in this
// codebase does element-vs-element geometric intersection anywhere else —
// every existing Box3/raycaster usage (sectionBoxGeometry.ts, camera
// framing, pointer-picking in PathGizmo.tsx) is plane-clipping or
// point/NDC testing, not real mesh-vs-mesh overlap. three-mesh-bvh is the
// standard three.js addon for exactly this (BVH-accelerated
// intersectsGeometry/closestPointToGeometry) rather than hand-rolled
// triangle-intersection code.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(THREE.Mesh.prototype as any).raycast = acceleratedRaycast

const IDENTITY = new THREE.Matrix4()

// Known v1 simplification, not an oversight: distances/tolerances here
// assume scene units are already metres. web-ifc keeps each element's
// geometry in that IFC file's own native unit (ifcModel.ts's own
// loadIfcModel — no metre-normalization happens at import time; see that
// file's header on getLengthUnitToMetres), so a project authored in, say,
// feet would need a per-model correction this doesn't do. No other
// geometry feature in this app (Box3 selection, camera framing, the
// section box) corrects for that either — the same assumption, just newly
// load-bearing for a numeric tolerance instead of a purely visual
// operation. Worth revisiting with real per-handle unit correction
// (getLengthUnitToMetres, already used by TransformPanel.tsx) if a
// mixed-unit project ever makes a "5mm clearance" mean something else in
// practice.
const MM_PER_SCENE_UNIT = 1000

export interface ClashElementRef {
  sourceKind: 'ifc' | 'mesh'
  ref: string
  label: string
}

export interface ResolvedClashElement {
  ref: ClashElementRef
  meshes: THREE.Mesh[]
}

export interface ClashPairResult {
  elementA: ClashElementRef
  elementB: ClashElementRef
  distanceMm: number | null
}

// Same LinkableSceneObject shape linkedElements.ts's own resolver takes —
// duplicated rather than imported to keep this file free of a three.js-less
// module depending back on one, matching that file's own stated reasoning
// for not sharing code with Viewport3D.tsx's live-object resolution either.
export interface ClashSceneObject {
  id: string
  kind: 'ifc' | 'mesh'
  name: string
  object: THREE.Object3D
}

// A mesh-kind Collection member means "the whole imported file" (see
// CollectionMember's own docstring) — every THREE.Mesh under that object
// is this element's geometry. An IFC member is one GlobalId, which
// resolveElementRefsToTargets-style lookup turns into an expressID; a
// single IFC element can still be >1 mesh (loadIfcModel's own inner loop
// over flatMesh.geometries), so this collects all of them, not just the
// first match.
export async function resolveMembersToElements(
  members: { source_kind: 'ifc' | 'mesh'; element_ref: string; element_label: string }[],
  sceneObjects: ClashSceneObject[],
  ifcHandles: IfcModelHandle[],
): Promise<ResolvedClashElement[]> {
  const resolved: ResolvedClashElement[] = []
  if (members.length === 0) return resolved

  const needsIfc = members.some(m => m.source_kind === 'ifc') && ifcHandles.length > 0
  const ifcModel = needsIfc ? await import('./ifcModel') : null

  for (const member of members) {
    const ref: ClashElementRef = { sourceKind: member.source_kind, ref: member.element_ref, label: member.element_label }
    const meshes: THREE.Mesh[] = []

    if (member.source_kind === 'mesh') {
      const match = sceneObjects.find(o => o.kind === 'mesh' && o.name === member.element_ref)
      match?.object.traverse(child => { if (child instanceof THREE.Mesh) meshes.push(child) })
    } else if (ifcModel) {
      for (const handle of ifcHandles) {
        const expressId = ifcModel.getExpressIdFromGuid(handle, member.element_ref)
        if (expressId === undefined) continue
        // ensureMaterialized, not a plain traverse (2026-07-17) — an
        // element whose geometry repeats elsewhere in the file may still
        // be sitting in ifcModel.ts's shared THREE.BatchedMesh rather than
        // its own traversable mesh (see elementBatching.ts's own header);
        // a plain userData.expressID traverse would silently find nothing
        // for it and this element would just never clash-test at all,
        // with no error to say why.
        const mesh = ifcModel.ensureMaterialized(handle.object, expressId)
        if (mesh) meshes.push(mesh)
        break
      }
    }

    if (meshes.length > 0) resolved.push({ ref, meshes })
  }
  return resolved
}

// Baked into world space (clone + applyMatrix4(matrixWorld)) rather than
// built once on the raw local geometry with a per-pair transform — a mesh's
// own local space can carry a non-uniform scale relative to the scene
// (Transform panel edits, animated Mode B/C scale keyframes), which would
// silently distort measured distances if compared in that local space
// instead of world space. Memoized only for the lifetime of one findClashes
// call (the local `cache` Map below), not across runs or frames — this is
// "test whatever's on screen right now" (see this file's own header),
// re-baked fresh on every Run Test click, which is also what makes it
// automatically correct for whatever the timeline's current animation state
// is.
function buildWorldBVH(mesh: THREE.Mesh): { bvh: MeshBVH; geometry: THREE.BufferGeometry; box: THREE.Box3 } {
  mesh.updateWorldMatrix(true, false)
  const geometry = mesh.geometry.clone()
  geometry.applyMatrix4(mesh.matrixWorld)
  const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute)
  geometry.computeBoundsTree()
  return { bvh: geometry.boundsTree as MeshBVH, geometry, box }
}

interface MeshPairOutcome {
  clashes: boolean
  distanceScene: number | null
}

function testMeshPair(
  a: { bvh: MeshBVH; geometry: THREE.BufferGeometry; box: THREE.Box3 },
  b: { bvh: MeshBVH; geometry: THREE.BufferGeometry; box: THREE.Box3 },
  testType: 'hard' | 'clearance',
  toleranceScene: number,
): MeshPairOutcome {
  const boxA = testType === 'clearance' ? a.box.clone().expandByScalar(toleranceScene) : a.box
  if (!boxA.intersectsBox(b.box)) return { clashes: false, distanceScene: null }

  if (testType === 'hard') {
    return { clashes: a.bvh.intersectsGeometry(b.geometry, IDENTITY), distanceScene: null }
  }

  const found = a.bvh.closestPointToGeometry(b.geometry, IDENTITY, undefined, undefined, 0, toleranceScene)
  if (!found) return { clashes: false, distanceScene: null }
  return { clashes: true, distanceScene: found.distance }
}

export type ClashProgressCallback = (done: number, total: number) => void

// Element-level pairs (not mesh-level) are what gets reported — an element
// clashes with another if ANY of their sub-mesh pairs do (hard), or the
// MINIMUM distance across all sub-mesh pairs is what's reported (clearance).
// selfTest (group A and group B are the same Collection) skips an element
// against itself and only visits each unordered pair once, canonicalizing
// elementA/elementB by sorted ref so a re-run's pairs line up with
// ClashResult's own unique-pair key (see clash_result.py's own docstring).
export async function findClashes(
  elementsA: ResolvedClashElement[],
  elementsB: ResolvedClashElement[],
  testType: 'hard' | 'clearance',
  toleranceMm: number,
  selfTest: boolean,
  onProgress?: ClashProgressCallback,
): Promise<ClashPairResult[]> {
  const toleranceScene = toleranceMm / MM_PER_SCENE_UNIT
  const cache = new Map<THREE.Mesh, { bvh: MeshBVH; geometry: THREE.BufferGeometry; box: THREE.Box3 }>()
  const getEntry = (mesh: THREE.Mesh) => {
    let entry = cache.get(mesh)
    if (!entry) { entry = buildWorldBVH(mesh); cache.set(mesh, entry) }
    return entry
  }

  const results: ClashPairResult[] = []
  const pairs: [ResolvedClashElement, ResolvedClashElement][] = []
  if (selfTest) {
    for (let i = 0; i < elementsA.length; i++) {
      for (let j = i + 1; j < elementsA.length; j++) pairs.push([elementsA[i], elementsA[j]])
    }
  } else {
    for (const elA of elementsA) for (const elB of elementsB) pairs.push([elA, elB])
  }

  let done = 0
  for (const [elA, elB] of pairs) {
    let clashed = false
    let minDistanceScene: number | null = null
    outer: for (const meshA of elA.meshes) {
      const entryA = getEntry(meshA)
      for (const meshB of elB.meshes) {
        const outcome = testMeshPair(entryA, getEntry(meshB), testType, toleranceScene)
        if (outcome.clashes) {
          clashed = true
          if (outcome.distanceScene !== null && (minDistanceScene === null || outcome.distanceScene < minDistanceScene)) {
            minDistanceScene = outcome.distanceScene
          }
          if (testType === 'hard') break outer  // boolean test — first hit is enough
        }
      }
    }

    if (clashed) {
      const [refA, refB] = selfTest && elA.ref.ref > elB.ref.ref ? [elB.ref, elA.ref] : [elA.ref, elB.ref]
      results.push({
        elementA: refA, elementB: refB,
        distanceMm: minDistanceScene === null ? null : minDistanceScene * MM_PER_SCENE_UNIT,
      })
    }

    done += 1
    if (done % 25 === 0) {
      onProgress?.(done, pairs.length)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  onProgress?.(pairs.length, pairs.length)

  for (const entry of cache.values()) entry.geometry.disposeBoundsTree()
  return results
}
