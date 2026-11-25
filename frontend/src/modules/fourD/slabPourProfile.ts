import { ExtrudeGeometry, Group, Line3, Mesh, ShapeUtils, Vector3 } from 'three'
import { constructionTriangles, faceShapes, flatFaceRings, isExterior } from './constructionHost'
import { checkSolid, disposeBooleanResults, volume, type BooleanResult } from './shapeBoolean'

type Triangle = [Vector3, Vector3, Vector3]
const tolerance = .0001

// Compare in plan, allowing different starting corners, winding and triangulation.
export function sameOutline(a: ReturnType<typeof flatFaceRings>, b: ReturnType<typeof flatFaceRings>) {
  if (a.length !== b.length) return false
  return a.every(ring => b.some(other => {
    if (other.length !== ring.length) return false
    const start = other.findIndex(p => p.distanceTo(ring[0]) <= tolerance)
    return start >= 0 && [1, -1].some(step => ring.every((p, i) =>
      p.distanceTo(other[(start + step * i + ring.length) % ring.length]) <= tolerance))
  }))
}

function clippedFace(face: Triangle[], normal: Vector3, offset: number, side: number): Triangle[] {
  const result: Triangle[] = []
  for (const triangle of face) {
    const polygon: Vector3[] = []
    const distances = triangle.map(p => {
      const distance = (normal.dot(p) - offset) * side
      return Math.abs(distance) < 1e-8 ? 0 : distance
    })
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3, a = distances[i], b = distances[j]
      if (a >= 0) polygon.push(triangle[i])
      if (a * b < 0) polygon.push(triangle[i].clone().lerp(triangle[j], a / (a - b)))
    }
    for (let i = 1; i + 1 < polygon.length; i++) result.push([polygon[0], polygon[i], polygon[i+1]])
  }
  return result
}

// Rebuild the two pours only when both horizontal faces independently describe
// the same extrusion. An IFC opening subtraction can omit a reveal triangle.
export function verifiedSlabProfile(slab: Group, edgeUncertainty = 0) {
  const { triangles, worldBounds } = constructionTriangles(slab, 'y')
  const bottom = worldBounds.min.y, top = worldBounds.max.y, depth = top - bottom
  if (!(depth > tolerance)) return null
  const base: Triangle[] = [], lid: Triangle[] = [], sides: Triangle[] = []
  const onBase = (p: Vector3) => Math.abs(p.y - bottom) <= tolerance
  const onLid = (p: Vector3) => Math.abs(p.y - top) <= tolerance
  for (const triangle of triangles) {
    if (triangle.every(onBase)) base.push(triangle)
    else if (triangle.every(onLid)) lid.push(triangle)
    else if (triangle.every(p => onBase(p) || onLid(p))) sides.push(triangle)
    else return null
  }
  const outline = flatFaceRings(base, 'y', bottom)
  if (!outline.length || !sameOutline(outline, flatFaceRings(lid, 'y', top))) return null
  const planArea = outline.reduce((sum,r) => sum + (isExterior(r,outline) ? 1 : -1) * Math.abs(ShapeUtils.area(r)), 0)
  const faceArea = (face: Triangle[]) => face.reduce((sum,[a,b,c]) =>
    sum + Math.abs((b.x-a.x)*(c.z-a.z) - (b.z-a.z)*(c.x-a.x))/2, 0)
  const perimeter = outline.reduce((sum,ring) => sum + ring.reduce((length,p,i) => length+p.distanceTo(ring[(i+1)%ring.length]),0),0)
  if ([base,lid].some(face => Math.abs(faceArea(face)-planArea) > Math.max(1e-8,planArea*1e-6,perimeter*edgeUncertainty))) return null

  // Reject internal, sloping or recessed sides even if the two caps look alike.
  const edges = outline.flatMap((ring,ringIndex) => ring.map((p,i) => {
    const q = ring[(i+1)%ring.length]
    return {ringIndex, line:new Line3(new Vector3(p.x,0,p.y),new Vector3(q.x,0,q.y))}
  }))
  const nearest = new Vector3(), sidedRings = new Set<number>()
  for (const triangle of sides) {
    const points = triangle.map(p => new Vector3(p.x,0,p.z))
    const boundary = edges.find(edge => points.every(p =>
      edge.line.closestPointToPoint(p,true,nearest).distanceToSquared(p) <= tolerance*tolerance))
    if (!boundary) return null
    if (points.some(p => p.distanceToSquared(points[0]) > tolerance*tolerance)) sidedRings.add(boundary.ringIndex)
  }

  if (sidedRings.size !== outline.length) return null

  return {base, outline, bottom, top, depth, planArea}
}

export function splitSlabProfile(slab: Group, normal: Vector3, offset: number): BooleanResult[] | null {
  const profile = verifiedSlabProfile(slab)
  if (!profile) return null
  const {base, bottom, top, depth, planArea} = profile
  const source = slab.children[0] as Mesh
  const material = Array.isArray(source.material) ? source.material[0] : source.material
  const pieces: BooleanResult[] = []
  try {
    for (const side of [-1,1]) {
      const rings = flatFaceRings(clippedFace(base,normal,offset,side),'y',bottom)
      if (!rings.length) throw Error('Extend the break through the slab interior.')
      const geometry = new ExtrudeGeometry(faceShapes(rings),{depth,bevelEnabled:false})
      const mesh = new Mesh(geometry,material.clone())
      const position = new Vector3()
      pieces.push({name:'Pour zone',mesh,position})
      geometry.clearGroups()
      geometry.rotateX(Math.PI/2).translate(0,top,0)
      geometry.computeBoundingBox()
      const bounds = geometry.boundingBox!
      bounds.getCenter(position)
      position.y = bounds.min.y
      geometry.translate(-position.x,-position.y,-position.z)
      checkSolid(geometry)
    }
    const total = pieces.reduce((sum,piece) => sum + volume(piece.mesh.geometry), 0)
    const expected = planArea * depth
    if (Math.abs(total - expected) > Math.max(1e-8, expected * 1e-5)) {
      throw Error('The pour zones could not preserve the slab volume. Check the break against the slab edges.')
    }
    return pieces
  } catch (error) {
    disposeBooleanResults(pieces)
    throw error
  }
}
