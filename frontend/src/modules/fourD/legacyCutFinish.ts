import { Box3, Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'

// Both old CSG primitives can share a POSITION accessor. Bounds must use
// the indices of the faces actually drawn by each material.
function surfaceBounds(mesh: Mesh) {
  const {index, attributes:{position}} = mesh.geometry
  const box = new Box3(), point = new Vector3()
  for (let i = 0; i < (index?.count ?? position.count); i++) {
    box.expandByPoint(point.fromBufferAttribute(position, index ? index.getX(i) : i))
  }
  return box
}

// Older shape operations could snapshot an IFC cutter while the viewport
// highlighted it. Match both the baked emissive and the diffuse colour mix
// used by that renderer, to distinguish it from an intentionally blue finish.
function hasHighlightedCyanCutter(material: MeshStandardMaterial) {
  const highlight = new Color(0x2563eb)
  if (material.emissive.getHex() !== 0x2563eb) return false
  const strength = material.emissiveIntensity
  const mix = Math.abs(strength - 1.1) < .0001 ? .6 : Math.abs(strength - .9) < .0001 ? .55 : 0
  if (!mix) return false
  const expected = new Color(0x00ffff).lerp(highlight, mix)
  return Math.max(Math.abs(expected.r - material.color.r), Math.abs(expected.g - material.color.g),
    Math.abs(expected.b - material.color.b)) < .0001
}

export function restoreLegacyCutFinish(scene: Group, document: {
  asset?: {generator?: string}; nodes?: {name?: string; extras?: unknown; mesh?: number}[];
  meshes?: {primitives: {mode?: number; indices?: number; attributes: {POSITION: number}; material?: number}[]}[]
}) {
  const node = document.nodes?.[0], primitives = document.meshes?.[0]?.primitives
  if (!document.asset?.generator?.startsWith('THREE.GLTFExporter ') || scene.name !== 'AuxScene' ||
      document.nodes?.length !== 1 || node?.name !== 'Result' || node.mesh !== 0 || node.extras ||
      primitives?.length !== 2 || primitives.some(p => (p.mode ?? 4) !== 4 || p.indices === undefined) ||
      primitives[0].attributes.POSITION !== primitives[1].attributes.POSITION ||
      primitives[0].material !== 0 || primitives[1].material !== 1) return

  const pieces: Mesh[] = []
  scene.traverse(o => { if (o instanceof Mesh) pieces.push(o) })
  if (pieces.length !== 2) return
  const [base, wall] = pieces
  const source = base.material, cutter = wall.material
  if (!(source instanceof MeshStandardMaterial) || !(cutter instanceof MeshStandardMaterial) ||
      cutter.map || cutter.emissiveMap || source.color.equals(cutter.color)) return
  const highlighted = hasHighlightedCyanCutter(cutter)
  if (!highlighted && (cutter.color.getHex() !== 0x00ffff || cutter.emissive.getHex() !== 0)) return

  const outer = surfaceBounds(base), inner = surfaceBounds(wall)
  const eps = 1e-5
  if (outer.isEmpty() || inner.isEmpty() ||
      Math.abs(inner.min.y - outer.min.y) > eps || Math.abs(inner.max.y - outer.max.y) > eps) return
  const hole = inner.min.x > outer.min.x + eps && inner.max.x < outer.max.x - eps &&
    inner.min.z > outer.min.z + eps && inner.max.z < outer.max.z - eps
  // An intersected insert has the reverse winding. Its outer walls share the
  // footprint of its caps, and in the affected old file carry the selection glow.
  const insert = highlighted && outer.min.distanceTo(inner.min) <= eps && outer.max.distanceTo(inner.max) <= eps
  if (!hole && !insert) return
  const centre = inner.getCenter(new Vector3()), a = new Vector3(), b = new Vector3(), c = new Vector3(), toward = new Vector3()
  const {index, attributes:{position}} = wall.geometry
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    a.fromBufferAttribute(position, index ? index.getX(i) : i)
    b.fromBufferAttribute(position, index ? index.getX(i+1) : i+1)
    c.fromBufferAttribute(position, index ? index.getX(i+2) : i+2)
    const normal = b.sub(a).cross(c.sub(a)).normalize()
    const inward = normal.dot(toward.subVectors(centre, a))
    if (Math.abs(normal.y) > .001 || (hole ? inward <= 0 : inward >= 0)) return
  }
  // Retain the old slot identity so a project with an explicit face override
  // still honours that edit. Otherwise its finish follows the base slot.
  wall.material = source.clone()
  wall.material.userData.prosotaAssetSlot = cutter.userData.prosotaAssetSlot
  wall.material.userData.prosotaCutBaseSlot = source.userData.prosotaAssetSlot
  cutter.dispose()
}
