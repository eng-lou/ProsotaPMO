import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { ImportedObject, ResolvedSectionBox } from './Viewport3D'
import type { SectionBoxBounds, SectionBoxRotation } from './sectionBoxes'
import { computeWorldClipPlanes, sectionBoxPivotMatrix } from './sectionBoxGeometry'
import { ensureMaterialized } from './elementBatching'

// Solid-filled cut faces (2026-07-09, per Maro's explicit choice over the
// simpler hollow/open cutaway when asked). Deliberately NOT three.js's
// stencil-buffer capping technique (webgl_clipping_stencil) — an earlier
// version tried that and it came out glitchy/wrong twice in a row despite
// two rounds of targeted fixes; rather than keep debugging a fragile,
// hard-to-verify-without-a-browser GPU technique, this is a plain flat
// quad per cut face, clipped by the box's other 5 planes, no stencil test
// at all. For any solid, convex-ish shape (a cube, a wall, most real
// building elements) this looks *identical* to the full stencil technique
// — the cross-section through solid material really is just the box's
// own bounding rectangle at that plane. It only falls short of the "real"
// technique for genuinely hollow/concave geometry (a pipe, an L-shaped
// slab with the box straddling the notch), where the cap would show as a
// full rectangle instead of following the actual material's silhouette —
// an acceptable tradeoff for something that reliably works over something
// that doesn't.
type FaceId = 'min_x' | 'max_x' | 'min_y' | 'max_y' | 'min_z' | 'max_z'
// Same order computeWorldClipPlanes (sectionBoxGeometry.ts) returns its 6
// planes in — index-matched against that array below rather than
// recomputing planes locally, since clippingPlanes must always be in
// world space (three.js never auto-transforms them through an object's
// own parent chain, unlike ordinary geometry) and this app already has
// exactly one place that does that transform correctly.
const FACE_ORDER: FaceId[] = ['min_x', 'max_x', 'min_y', 'max_y', 'min_z', 'max_z']

interface FaceDef {
  id: FaceId
  localPlane: THREE.Plane
  center: THREE.Vector3
  size: [number, number]
  rotation: [number, number, number]
}

function facesFor(bounds: SectionBoxBounds): FaceDef[] {
  const sizeX = bounds.max_x - bounds.min_x
  const sizeY = bounds.max_y - bounds.min_y
  const sizeZ = bounds.max_z - bounds.min_z
  const cx = (bounds.min_x + bounds.max_x) / 2
  const cy = (bounds.min_y + bounds.max_y) / 2
  const cz = (bounds.min_z + bounds.max_z) / 2
  const build = (id: FaceId, localPlane: THREE.Plane, center: THREE.Vector3, size: [number, number], rotation: [number, number, number]): FaceDef => (
    { id, localPlane, center, size, rotation }
  )
  return [
    build('min_x', new THREE.Plane(new THREE.Vector3(1, 0, 0), -bounds.min_x), new THREE.Vector3(bounds.min_x, cy, cz), [sizeZ, sizeY], [0, -Math.PI / 2, 0]),
    build('max_x', new THREE.Plane(new THREE.Vector3(-1, 0, 0), bounds.max_x), new THREE.Vector3(bounds.max_x, cy, cz), [sizeZ, sizeY], [0, Math.PI / 2, 0]),
    build('min_y', new THREE.Plane(new THREE.Vector3(0, 1, 0), -bounds.min_y), new THREE.Vector3(cx, bounds.min_y, cz), [sizeX, sizeZ], [Math.PI / 2, 0, 0]),
    build('max_y', new THREE.Plane(new THREE.Vector3(0, -1, 0), bounds.max_y), new THREE.Vector3(cx, bounds.max_y, cz), [sizeX, sizeZ], [-Math.PI / 2, 0, 0]),
    build('min_z', new THREE.Plane(new THREE.Vector3(0, 0, 1), -bounds.min_z), new THREE.Vector3(cx, cy, bounds.min_z), [sizeX, sizeY], [0, Math.PI, 0]),
    build('max_z', new THREE.Plane(new THREE.Vector3(0, 0, -1), bounds.max_z), new THREE.Vector3(cx, cy, bounds.max_z), [sizeX, sizeY], [0, 0, 0]),
  ]
}

// Skips capping a face whose plane doesn't currently intersect the
// anchor's own local-space bounding box at all — a face pulled fully
// clear of the geometry needs no cap. Only meaningful when `box` is
// genuinely in the *same local frame* bounds themselves are defined in
// (see SectionBoxCapSet's own header on why that distinction matters) —
// callers that can't cheaply produce such a box just skip the check
// entirely rather than risk comparing incompatible frames.
function planeIntersectsBox(plane: THREE.Plane, box: THREE.Box3): boolean {
  return plane.intersectsBox(box)
}

// The cap's own color always tracks a representative mesh's real material
// color (2026-07-09, per Maro: "make it color of the material itself") —
// read fresh every frame (see the useFrame below) so it keeps up with the
// same live texture-override system the rest of this app already uses
// (TextureFields.tsx can change a mesh's own material color at any time).
// Materials with no plain `.color` fall back to white rather than guessing.
function meshColor(mesh: THREE.Mesh): THREE.Color {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  return mat && 'color' in mat && (mat as { color: unknown }).color instanceof THREE.Color
    ? (mat as THREE.MeshStandardMaterial).color
    : new THREE.Color(0xffffff)
}

// One Section Box's own set of flat cap quads, tracking `anchor`'s live
// matrixWorld every frame — same technique as SectionBoxGizmo.tsx's own
// group (this group sits at the scene root, not nested inside the
// anchor's own ancestor wrappers, so copying matrixWorld directly
// reproduces the exact right world transform with no double-transform
// risk).
//
// `anchor` MUST be the exact same object `bounds` were computed relative
// to at creation time (FourD.tsx's handleCreateSectionBox) — the whole
// target object for a whole-object-scope box, or the one specific element
// mesh for an element-scope box (2026-07-09 fix: an earlier version used
// each individual *mesh's* own matrixWorld here for whole-object scope,
// which is wrong whenever a mesh has its own nested transform relative to
// its parent object — exactly the same class of bug ModelObjects's own
// clip-plane application in Viewport3D.tsx already avoids, by always
// computing planes against the *object*, not each mesh separately, then
// applying that one shared plane set uniformly to every mesh under it).
// `colorMesh` only supplies a representative color and is never used for
// any transform math.
function SectionBoxCapSet({ anchor, colorMesh, bounds, rotation, skipBox }: {
  anchor: THREE.Object3D
  colorMesh: THREE.Mesh | null
  bounds: SectionBoxBounds
  rotation: SectionBoxRotation
  skipBox: THREE.Box3 | null
}) {
  const groupRef = useRef<THREE.Group>(null)

  // Each face's own localPlane is rotated by the SAME sectionBoxPivotMatrix
  // the actual cap quad renders through (2026-07-17 fix, per Maro: "the
  // material of the section box is weird" on a rotated box — this check
  // used to compare skipBox, always in the element's own real, unrotated
  // geometry frame, against the plane's ORIGINAL unrotated position, while
  // the cap itself had already started rendering at its real *rotated*
  // position. A face the rotated box no longer actually intersected could
  // still pass this stale check and render its full flat quad anyway,
  // covering real geometry it should have left alone.
  const faces = useMemo(() => {
    const all = facesFor(bounds)
    if (!skipBox) return all
    const pivot = sectionBoxPivotMatrix(bounds, rotation)
    return all.filter(f => planeIntersectsBox(f.localPlane.clone().applyMatrix4(pivot), skipBox))
  }, [skipBox, bounds.min_x, bounds.min_y, bounds.min_z, bounds.max_x, bounds.max_y, bounds.max_z, rotation.rot_x, rotation.rot_y, rotation.rot_z])

  // Unlit (MeshBasicMaterial), deliberately — a cap face isn't real
  // material, and an unlit flat color can't pick up environment-map noise
  // on a large surface the way a lit material could.
  //
  // Semi-transparent, not opaque (2026-07-17, per Maro: on a slab with real
  // cutouts, "just more transparency" — this cap is always a flat
  // rectangle sized to the box's own cross-section, not the real
  // material's silhouette, see this component's own header on why a
  // "real" silhouette-following cap was tried and abandoned twice already.
  // Opaque, that full rectangle fully hid the actual geometry (and its
  // real cutouts) wherever the cap over-covered it; translucent, the real
  // geometry underneath stays visible through the tint instead of getting
  // hidden — doesn't fix the over-coverage itself, but stops it from
  // reading as "wrong," since you can now see what's actually there.
  const materials = useMemo(
    () => faces.map(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.55 })),
    [faces],
  )

  useFrame(() => {
    if (!groupRef.current) return
    anchor.updateMatrixWorld(true)
    // Composed with the box's own rotation (2026-07-17, per Maro: "I'd
    // like to rotate the bounding box") — same sectionBoxPivotMatrix
    // SectionBoxGizmo.tsx's own group and computeWorldClipPlanes below
    // both use, so the visible cap quads, the wireframe/handles, and the
    // actual clip all agree on where the box currently sits.
    groupRef.current.matrix.copy(anchor.matrixWorld).multiply(sectionBoxPivotMatrix(bounds, rotation))
    groupRef.current.matrixAutoUpdate = false
    groupRef.current.matrixWorldNeedsUpdate = true

    const worldPlanes = computeWorldClipPlanes(bounds, rotation, anchor.matrixWorld)
    const color = colorMesh ? meshColor(colorMesh) : new THREE.Color(0xffffff)
    faces.forEach((face, i) => {
      materials[i].color.copy(color)
      materials[i].clippingPlanes = worldPlanes.filter((_, j) => FACE_ORDER[j] !== face.id)
    })
  })

  useEffect(() => () => { materials.forEach(m => m.dispose()) }, [materials])

  return (
    <group ref={groupRef}>
      {faces.map((face, i) => (
        <mesh key={face.id} position={face.center} rotation={face.rotation} material={materials[i]}>
          <planeGeometry args={face.size} />
        </mesh>
      ))}
    </group>
  )
}

// Above this many meshes in scope, a whole-object box's caps auto-fall
// back to hollow-only instead of rendering — this feature's own design
// plan flagged whole-IFC-model-scope caps as a real performance risk
// worth capping rather than shipping un-validated against Maro's actual
// real-scale BIM models, which there's no way to load-test from here. A
// big whole-model box silently keeps the hollow cutaway (still fully
// functional, just without the solid fill) instead of risking frame rate.
// Element-scoped boxes are exempt (always exactly one mesh, trivially
// cheap regardless of the parent model's size).
const WHOLE_OBJECT_CAP_MESH_LIMIT = 150

// Every active, cappable Section Box's own cap set (2026-07-09) — caps
// individual IFC elements (exactly one mesh, always: bounds and the cap's
// own anchor are both that element's own mesh) and whole-object scope
// (bounds and anchor are both the whole object; a representative color is
// sampled from its first mesh) up to WHOLE_OBJECT_CAP_MESH_LIMIT above.
// One cap set per box, not per mesh — matches ModelObjects's own "compute
// planes once against the object, apply everywhere" pattern, now that
// there's no longer any per-mesh geometry-sharing reason (the old stencil
// approach needed one) to do otherwise.
export function SectionBoxCaps({ boxes, objects }: { boxes: ResolvedSectionBox[]; objects: ImportedObject[] }) {
  return (
    <>
      {boxes.filter(b => b.active).flatMap(box => {
        const entry = objects.find(o => o.id === box.sceneObjectId)
        if (!entry) return []
        if (box.elementExpressId !== undefined) {
          // ensureMaterialized, not a plain traverse (2026-07-17) — see
          // elementBatching.ts's own header.
          const found = ensureMaterialized(entry.object, box.elementExpressId)
          if (!found) return []
          const mesh: THREE.Mesh = found
          mesh.geometry.computeBoundingBox()
          const skipBox = mesh.geometry.boundingBox ?? new THREE.Box3().setFromObject(mesh)
          return [<SectionBoxCapSet key={box.id} anchor={mesh} colorMesh={mesh} bounds={box.bounds} rotation={box.rotation} skipBox={skipBox} />]
        }
        let colorMesh: THREE.Mesh | null = null
        let meshCount = 0
        entry.object.traverse(child => {
          if (child instanceof THREE.Mesh) { meshCount++; if (!colorMesh) colorMesh = child }
        })
        if (meshCount === 0 || meshCount > WHOLE_OBJECT_CAP_MESH_LIMIT) return []
        // No cheap "does this face intersect the geometry" pre-check for
        // whole-object scope — that needs a bounding box in the *object's*
        // own local frame (matching where `bounds` themselves live), which
        // isn't something any single mesh's own geometry.boundingBox can
        // give directly across a multi-mesh object. Rendering all (up to)
        // 6 faces unconditionally here is the correctness-first tradeoff.
        return [<SectionBoxCapSet key={box.id} anchor={entry.object} colorMesh={colorMesh} bounds={box.bounds} rotation={box.rotation} skipBox={null} />]
      })}
    </>
  )
}
