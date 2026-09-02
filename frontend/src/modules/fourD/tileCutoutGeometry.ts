import * as THREE from 'three'
import type { ZonePoint } from './zones'
import type { UpAxis } from './upAxis'

// Tile Cutout (2026-09-02) — clips Google Photorealistic 3D Tiles to the
// footprint of an existing Zone, so a project's own IFC/mesh model can sit
// in the resulting gap (e.g. Euston Station: cut the existing station's
// own tile geometry out of the reconstruction plot, keep the surrounding
// real-world context tiles). See site_context.py's own model docstring for
// the full v1-scope "why" — reuses Zone's proven polygon-drawing/editing
// rather than a second system, at the cost of only supporting one convex
// cutout at a time (three.js Material.clippingPlanes can express a convex
// region or its complement, but not an arbitrary concave hole or more than
// one independent cutout on the same material simultaneously — CesiumJS's
// own ClippingPolygonCollection does both via a custom per-fragment shader
// test this does not attempt yet).
//
// Same {x,y,z}-with-up-coordinate-zeroed convention as zoneGeometry.ts's
// own toLocal2D/toVec3 — Zone points are already real world/live-frame
// coordinates (captured directly off a raycast against the live scene),
// not a foreign canonical space needing an axis-correction transform, so
// this needs no group/matrixWorld math at all: plain vector algebra
// against the stored points is already correct in world space, which is
// what Material.clippingPlanes are defined in (confirmed against
// sectionBoxGeometry.ts's own computeWorldClipPlanes, the one other place
// in this codebase that builds clipping planes).
function toVec3(p: ZonePoint, upAxis: UpAxis): THREE.Vector3 {
  return upAxis === 'z' ? new THREE.Vector3(p.x, p.y, 0) : new THREE.Vector3(p.x, 0, p.z)
}

function upVector(upAxis: UpAxis): THREE.Vector3 {
  return upAxis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
}

// Simple convexity check via cross-product sign consistency (2026-09-02) —
// every consecutive edge-pair's turn must go the same way (all left turns
// or all right turns) for a simple, non-self-intersecting polygon to be
// convex. Used only to warn in SiteContextPanel.tsx, not to block a
// concave selection — this doesn't attempt to detect self-intersection
// (a genuinely malformed polygon), only "is this convex or not."
export function isConvexPolygon(points: ZonePoint[], upAxis: UpAxis): boolean {
  if (points.length < 3) return false
  const up = upVector(upAxis)
  const verts = points.map(p => toVec3(p, upAxis))
  let sign = 0
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]
    const b = verts[(i + 1) % verts.length]
    const c = verts[(i + 2) % verts.length]
    const cross = b.clone().sub(a).cross(c.clone().sub(b)).dot(up)
    if (Math.abs(cross) < 1e-9) continue // collinear edge — neither turn, doesn't break convexity
    const thisSign = Math.sign(cross)
    if (sign === 0) sign = thisSign
    else if (thisSign !== sign) return false
  }
  return true
}

// Builds one outward-facing world-space clipping plane per polygon edge.
// With `material.clipIntersection = true` (see SiteTilesLayer.tsx's own
// TileCutoutClipPlugin), three.js discards a fragment only if it fails
// every plane's own keep-test simultaneously — which, for outward-normal
// edge planes, is exactly "inside the convex polygon on every edge at
// once." A fragment outside the polygon fails at most one edge's keep-test
// and so is never discarded. (Verified against three.js's own installed
// clipping shader/WebGLClipping source, not assumed — this is the
// deliberate complement of sectionBoxGeometry.ts's own box-interior
// planes, which use the default clipIntersection=false union mode to KEEP
// only the inside of a box; this needs the opposite — discard only the
// inside of a polygon, keep everything outside.)
//
// Outward direction is resolved per-edge against the polygon's own
// centroid (`cross(edgeDir, up)` gives an in-ground-plane perpendicular;
// whichever of the two candidate signs points away from the centroid is
// "outward") rather than assumed from winding order, so this works
// regardless of whether a Zone's own points happen to be clockwise or
// counter-clockwise.
//
// Only correct for a convex polygon — see isConvexPolygon above. A
// concave input still produces N planes, but their intersection no longer
// matches the actual concave shape (typically clips away more than
// intended, roughly the shape's convex hull) — SiteContextPanel.tsx warns
// rather than silently producing a wrong-looking cutout.
export function computeCutoutWorldPlanes(points: ZonePoint[], upAxis: UpAxis): THREE.Plane[] {
  if (points.length < 3) return []
  const up = upVector(upAxis)
  const verts = points.map(p => toVec3(p, upAxis))
  const centroid = verts.reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(verts.length)

  const planes: THREE.Plane[] = []
  for (let i = 0; i < verts.length; i++) {
    const start = verts[i]
    const end = verts[(i + 1) % verts.length]
    const edgeDir = end.clone().sub(start)
    if (edgeDir.lengthSq() < 1e-9) continue // duplicate/zero-length edge — no plane to build

    const candidate = edgeDir.clone().cross(up).normalize()
    const towardCentroid = centroid.clone().sub(start).dot(candidate)
    const outward = towardCentroid > 0 ? candidate.clone().negate() : candidate

    planes.push(new THREE.Plane(outward, -outward.dot(start)))
  }
  return planes
}
