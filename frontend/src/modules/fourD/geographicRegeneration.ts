import type { GeographicContext, MapFeature } from './geographicContext'
import { editableMapFeatures } from './geographicSelection'

export interface PreserveOptions {
  materials: boolean
  geometry: boolean
  replacements: boolean
  featureIds: Set<string>
}

// Ring starts and winding can change in a new map response. Match faces by their
// endpoints, never by an index that may now refer to another side of a building.
function remapWallFinishes(before: MapFeature, after: MapFeature) {
  const surfaces: NonNullable<MapFeature['surfaces']> = {}
  const rings = [after.points, ...after.holes]
  const samePoint = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < .00001
  for (const [key, value] of Object.entries(before.surfaces || {})) {
    if (!key.startsWith('wall:')) { surfaces[key] = value; continue }
    const [, ringIndex, edgeIndex] = key.split(':').map(Number)
    const ring = [before.points, ...before.holes][ringIndex]
    if (!ring || !ring[edgeIndex]) return null
    const a = ring[edgeIndex], b = ring[(edgeIndex + 1) % ring.length]
    let match = ''
    rings.forEach((points, r) => points.forEach((c, e) => {
      const d = points[(e + 1) % points.length]
      if ((samePoint(a, c) && samePoint(b, d)) || (samePoint(a, d) && samePoint(b, c))) match = `wall:${r}:${e}`
    }))
    if (!match) return null
    surfaces[match] = value
  }
  return surfaces
}

export function mergeReconstruction(previous: GeographicContext, incoming: GeographicContext, preserve: PreserveOptions) {
  const old = new Map(editableMapFeatures(previous).map(f => [f.id, f]))
  const seen = new Set<string>(), missing: string[] = [], retainedGeometry: string[] = []
  const authoredIds = new Set([...previous.features, ...incoming.features].map(f => f.id))
  const features = editableMapFeatures(incoming).filter(f => authoredIds.has(f.id)).map(f => {
    seen.add(f.id)
    const before = old.get(f.id)
    if (!before || !preserve.featureIds.has(f.id)) return f
    let geometry = preserve.geometry
    let surfaces = before.surfaces
    if (preserve.materials && !geometry && !before.replacement) {
      const remapped = remapWallFinishes(before, f)
      if (remapped) surfaces = remapped
      else { geometry = true; retainedGeometry.push(f.id) }
    }
    return {
      ...f, hidden: before.hidden,
      ...(preserve.materials ? { color: before.color, roof_color: before.roof_color, surfaces } : {}),
      ...(geometry ? { points: before.points, holes: before.holes, height: before.height, height_basis: before.height_basis, roof: before.roof, roof_basis: before.roof_basis, width: before.width } : {}),
      ...(preserve.replacements ? { replacement: before.replacement } : {}),
    }
  })
  for (const f of old.values()) {
    if (!authoredIds.has(f.id) || seen.has(f.id) || !preserve.featureIds.has(f.id) || !(preserve.materials || preserve.geometry || preserve.replacements)) continue
    if (!f.points.every(p => Math.abs(p[0]) <= incoming.width / 2 && Math.abs(p[1]) <= incoming.depth / 2)) {
      throw Error('An edited feature lies outside the regenerated extent. Keep the same study boundary to preserve it.')
    }
    features.push(f)
    missing.push(f.id)
  }
  return { data: { ...incoming, features, detail: previous.detail, hidden_layers: previous.hidden_layers }, missing, retainedGeometry }
}
