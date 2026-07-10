import * as THREE from 'three'
import { IfcAPI } from 'web-ifc'
import { captureBaseline, captureOriginalMaterial } from './elementBaseline'

// "Import IFC" (2026-07-10, per Maro — linked github.com/ThatOpen/engine_components
// as "very important"). Uses web-ifc directly — the lower-level WASM parser
// ThatOpen's own engine_components is itself built on — rather than that
// higher-level framework, since it brought two separate peer-dependency
// conflicts with the react-three-fiber stack already in this project
// (three.js >=0.182 and camera-controls >=3.1.2, vs @react-three/drei's own
// camera-controls ^2.9.0 cap) with zero conflicts of its own. Its IfcLoader
// would have handed back a plain THREE.Object3D anyway, same as what's built
// here by hand from the raw geometry/property API.
//
// The geometry extraction and property/spatial-structure shapes below were
// verified empirically against two real sample files (a Revit-exported IFC4
// project and its IFC4 variant, both in the private docs repo) via a Node
// smoke test during development — not just API docs — specifically: vertex
// data is 6 floats per vertex (position xyz, normal xyz) interleaved;
// GetVertexDataSize()/GetIndexDataSize() are element counts, not bytes;
// property values arrive wrapped (`{value: ...}` for simple types,
// `{_representationValue: ...}` for measures) and need unwrapping.
//
// WASM is self-hosted (frontend/public/wasm-ifc/web-ifc.wasm, copied from
// node_modules/web-ifc at implementation time — needs re-copying if the
// web-ifc version ever changes) rather than pointed at a CDN, and forced
// single-threaded (no SharedArrayBuffer/COOP-COEP header requirements this
// app doesn't set up).
let apiPromise: Promise<IfcAPI> | null = null
function getApi(): Promise<IfcAPI> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = new IfcAPI()
      api.SetWasmPath('/wasm-ifc/', true)
      await api.Init(undefined, true)
      return api
    })()
  }
  return apiPromise
}

export interface IfcModelHandle {
  api: IfcAPI
  modelID: number
  object: THREE.Group
}

function colorToThree(c: { x: number; y: number; z: number; w: number }): THREE.Color {
  return new THREE.Color(c.x, c.y, c.z)
}

export async function loadIfcModel(file: File): Promise<IfcModelHandle> {
  const api = await getApi()
  const buffer = new Uint8Array(await file.arrayBuffer())
  const modelID = api.OpenModel(buffer)

  const group = new THREE.Group()
  group.name = file.name

  const flatMeshes = api.LoadAllGeometry(modelID)
  for (let i = 0; i < flatMeshes.size(); i++) {
    const flatMesh = flatMeshes.get(i)
    for (let j = 0; j < flatMesh.geometries.size(); j++) {
      const placed = flatMesh.geometries.get(j)
      const ifcGeom = api.GetGeometry(modelID, placed.geometryExpressID)
      const vertexData = api.GetVertexArray(ifcGeom.GetVertexData(), ifcGeom.GetVertexDataSize())
      const indexData = api.GetIndexArray(ifcGeom.GetIndexData(), ifcGeom.GetIndexDataSize())

      const vertexCount = vertexData.length / 6
      const positions = new Float32Array(vertexCount * 3)
      const normals = new Float32Array(vertexCount * 3)
      for (let v = 0, p = 0; v < vertexData.length; v += 6, p += 3) {
        positions[p] = vertexData[v]; positions[p + 1] = vertexData[v + 1]; positions[p + 2] = vertexData[v + 2]
        normals[p] = vertexData[v + 3]; normals[p + 1] = vertexData[v + 4]; normals[p + 2] = vertexData[v + 5]
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(indexData, 1))

      const material = new THREE.MeshStandardMaterial({
        color: colorToThree(placed.color),
        transparent: placed.color.w < 1,
        opacity: placed.color.w,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.applyMatrix4(new THREE.Matrix4().fromArray(placed.flatTransformation))
      mesh.userData.expressID = flatMesh.expressID
      // Its real placement within the model, not 0/0/0 — captured here,
      // right after applyMatrix4 decomposes flatTransformation into this
      // mesh's own local position/rotation/scale, so TransformPanel.tsx's
      // hover-Backspace reset can snap a hand-edited field back to what
      // this element actually started at (2026-07-09, per Maro — see
      // elementBaseline.ts's own header for the full story).
      captureBaseline(mesh)
      // The element's own real colour (from web-ifc's own per-element
      // `placed.color`) — captured so clearing a manual texture override
      // later can actually restore it, instead of leaving the last-applied
      // override showing forever (2026-07-09, per Maro: "when i change the
      // material and delete the material, it doesn't actually go back to
      // the default").
      captureOriginalMaterial(mesh)
      group.add(mesh)

      ifcGeom.delete()
    }
    // No flatMesh.delete() here despite web-ifc-api.d.ts declaring one
    // (2026-07-11 fix — real IFC file import threw "flatMesh.delete is not
    // a function") — IfcGeometry above is a genuine embind class_ instance
    // needing manual disposal, but FlatMesh comes back from LoadAllGeometry
    // as a plain value_object-converted JS struct with no delete method at
    // runtime in this web-ifc build; the .d.ts's delete(): void on it is
    // wrong. Nothing to free here either way — it's just a plain object.
  }

  // No axis-conversion rotation baked in here (2026-07-08 fix, per Maro:
  // default Rotation X showing -90 and the whole model rendering off-axis)
  // — this `group` is the exact object TransformPanel/gizmo edit, so baking
  // a fixed correction onto it made "no manual edits yet" look like
  // "rotated -90 already" and fought against Viewport3D.tsx's own Z-up/Y-up
  // display conversion (which was designed to correct Y-up-native content,
  // and IFC is natively Z-up already — the two corrections compounded
  // instead of cancelling). IFC is genuinely Z-up per its own spec; any
  // display-axis correction now lives entirely in Viewport3D.tsx's
  // axisCorrectionRotation (upAxis.ts), applied via a wrapper group around
  // this object rather than onto it.
  captureBaseline(group)
  return { api, modelID, object: group }
}

// GlobalId -> expressID (2026-07-11) — model_element_link.py's ifc-kind
// links are keyed by GlobalId (stable across re-imports), but every mesh in
// `handle.object` is tagged with expressID (loadIfcModel above), a WASM-
// session-local numeric id — this is what the 4D timeline (Viewport3D.tsx's
// TimelinePlayback) needs to go from "which activity/element is this link
// about" to "which THREE.Mesh do I actually animate". web-ifc's own
// GetExpressIdFromGuid lazily builds and caches a full guid<->expressID map
// on first call (CreateIfcGuidToExpressIdMapping, verified in
// node_modules/web-ifc/web-ifc-api.js) — cheap enough to call per-link
// on demand rather than needing to tag every mesh with its GlobalId
// upfront, since a project typically links far fewer elements than a full
// IFC model contains.
export function getExpressIdFromGuid(handle: IfcModelHandle, guid: string): number | undefined {
  // The underlying map stores both directions (guid->expressID and
  // expressID->guid) in one Map, so web-ifc's own type can't narrow which
  // side a given key returns — coerce, since we only ever call this with a
  // guid key.
  const result = handle.api.GetExpressIdFromGuid(handle.modelID, guid)
  return result === undefined ? undefined : Number(result)
}

// GlobalId for a given expressID — the exact reverse of getExpressIdFromGuid
// above (2026-07-11, for Collections' "Add Selected" — needs an
// element_ref, and GlobalId is what that means for source_kind="ifc", same
// as ModelElementLink). Deliberately not routed through getElementInfo,
// which pays for two full property-set round trips just to read one field
// off the result — this is a single synchronous web-ifc call, same idiom
// as getExpressIdFromGuid itself.
export function getGuidFromExpressId(handle: IfcModelHandle, expressID: number): string | undefined {
  const result = handle.api.GetGuidFromExpressId(handle.modelID, expressID)
  return result === undefined ? undefined : String(result)
}

// A snapshot-quality type name for a given expressID — same reasoning as
// getGuidFromExpressId above (Collections' element_label needs *something*
// readable, not a full getElementInfo property-set fetch). Same
// GetNameFromTypeCode call getTypeCounts below already uses, just for one
// specific element instead of every type in the model.
export function getElementTypeName(handle: IfcModelHandle, expressID: number): string {
  return handle.api.GetNameFromTypeCode(handle.api.GetLineType(handle.modelID, expressID))
}

export function disposeIfcModel(handle: IfcModelHandle) {
  handle.object.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose())
      else child.material.dispose()
    }
  })
  handle.api.CloseModel(handle.modelID)
}

export function getTypeCounts(handle: IfcModelHandle): { typeName: string; count: number }[] {
  const types = handle.api.GetAllTypesOfModel(handle.modelID)
  return types
    .map(t => ({ typeName: t.typeName, count: handle.api.GetLineIDsWithType(handle.modelID, t.typeID).size() }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count)
}

// Every expressID of one IFC type (2026-07-11, per Maro: "select all the
// doors" — Select by Type) — getTypeCounts above already looks up typeID
// via the same GetAllTypesOfModel call, but only ever keeps the *count*,
// discarding the actual ids. Reuses the exact .size()/.get(i) Vector
// idiom this file already uses at loadIfcModel above for flatMeshes/
// geometries.
export function getExpressIdsForType(handle: IfcModelHandle, typeName: string): number[] {
  const match = handle.api.GetAllTypesOfModel(handle.modelID).find(t => t.typeName === typeName)
  if (!match) return []
  const ids = handle.api.GetLineIDsWithType(handle.modelID, match.typeID)
  const out: number[] = []
  for (let i = 0; i < ids.size(); i++) out.push(ids.get(i))
  return out
}

export interface IfcTreeNode {
  expressID: number
  type: string
  children: IfcTreeNode[]
}

export async function getSpatialTree(handle: IfcModelHandle): Promise<IfcTreeNode> {
  return handle.api.properties.getSpatialStructure(handle.modelID, false) as unknown as Promise<IfcTreeNode>
}

// IFC values arrive wrapped — simple types as {value}, measures (area/
// length/volume/etc) as {_representationValue} — verified against real
// property data (Pset_RoofCommon's ProjectedArea/TotalArea) during
// development.
function unwrapIfcValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v !== 'object') return String(v)
  const obj = v as Record<string, unknown>
  if ('value' in obj) return String(obj.value)
  if ('_representationValue' in obj) return String(obj._representationValue)
  return '—'
}

export interface IfcPropertySetView {
  name: string
  properties: { name: string; value: string }[]
}

export interface IfcElementInfo {
  expressID: number
  type: string
  name: string
  globalId: string
  objectType: string
  tag: string
  predefinedType: string
  propertySets: IfcPropertySetView[]
}

export async function getElementInfo(handle: IfcModelHandle, expressID: number): Promise<IfcElementInfo> {
  const props = await handle.api.properties.getItemProperties(handle.modelID, expressID, false)
  const psets = await handle.api.properties.getPropertySets(handle.modelID, expressID, true, false)
  return {
    expressID,
    type: typeof props.type === 'number' ? handle.api.GetNameFromTypeCode(props.type) : String(props.type ?? ''),
    name: unwrapIfcValue(props.Name),
    globalId: unwrapIfcValue(props.GlobalId),
    objectType: unwrapIfcValue(props.ObjectType),
    tag: unwrapIfcValue(props.Tag),
    predefinedType: unwrapIfcValue(props.PredefinedType),
    propertySets: psets.map((p: Record<string, unknown>) => ({
      name: unwrapIfcValue(p.Name),
      properties: Array.isArray(p.HasProperties)
        ? p.HasProperties.map((prop: Record<string, unknown>) => ({
            name: unwrapIfcValue(prop.Name),
            value: unwrapIfcValue(prop.NominalValue),
          }))
        : [],
    })),
  }
}
