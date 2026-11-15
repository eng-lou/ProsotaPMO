import type { IfcAPI } from 'web-ifc'

export interface IfcPlacement {
  expressID: number; geometryExpressID: number; matrix: number[]
  color: { x: number; y: number; z: number; w: number }
}
export interface IfcGeometryData {
  version: 1
  geometries: { id: number; vertices: Float32Array; indices: Uint32Array }[]
  placements: IfcPlacement[]
}
const NON_PRODUCT_IFC_TYPES = new Set(['IFCSTYLEDITEM', 'IFCSURFACESTYLE', 'IFCSURFACESTYLERENDERING', 'IFCTRIMMEDCURVE', 'IFCVECTOR'])

// Shared by the dedicated import worker and the non-browser test fallback.
// The temporary native shape dies in this callback; these arrays are owned.
export function extractIfcGeometry(api: IfcAPI, modelID: number, progress?: (count: number) => void): IfcGeometryData {
  const geometries = new Map<number, IfcGeometryData['geometries'][number]>()
  const placements: IfcPlacement[] = []
  let notified = 0
  api.StreamAllMeshes(modelID, flatMesh => {
    if (NON_PRODUCT_IFC_TYPES.has(api.GetNameFromTypeCode(api.GetLineType(modelID, flatMesh.expressID)))) return
    for (let j = 0; j < flatMesh.geometries.size(); j++) {
      const placed = flatMesh.geometries.get(j), id = placed.geometryExpressID
      if (!geometries.has(id)) {
        const native = api.GetGeometry(modelID, id)
        try {
          geometries.set(id, { id, vertices: api.GetVertexArray(native.GetVertexData(), native.GetVertexDataSize()),
            indices: api.GetIndexArray(native.GetIndexData(), native.GetIndexDataSize()) })
        } finally { native.delete() }
      }
      placements.push({ expressID: flatMesh.expressID, geometryExpressID: id, matrix: Array.from(placed.flatTransformation),
        color: { x: placed.color.x, y: placed.color.y, z: placed.color.z, w: placed.color.w } })
    }
    if (placements.length - notified >= 1000) { notified = placements.length; progress?.(notified) }
  })
  return { version: 1, geometries: [...geometries.values()], placements }
}

export function geometryDataBytes(data: IfcGeometryData) {
  return data.geometries.reduce((sum, g) => sum + g.vertices.byteLength + g.indices.byteLength, 0) + data.placements.length * 200
}
