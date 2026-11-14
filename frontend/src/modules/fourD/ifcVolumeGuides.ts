import * as THREE from 'three'

type VolumeOutline = THREE.LineSegments<THREE.EdgesGeometry, THREE.LineDashedMaterial>

// Only the piece's own surface style identifies a guide. A camera housing
// can list "Field of View" among the materials of the complete IFC product.
export function isVolumeStyle(style: string) {
  return /\b(field[\s_-]+of[\s_-]+view|clearance[\s_-]+zone)\b/i.test(style)
}

export function makeVolumeOutline(geometry: THREE.BufferGeometry, colour: THREE.Color): VolumeOutline {
  const edges = new THREE.EdgesGeometry(geometry, 12)
  edges.computeBoundingSphere()
  const dash = Math.max(0.0001, (edges.boundingSphere?.radius ?? 1) / 12)
  const lines = new THREE.LineSegments(edges, new THREE.LineDashedMaterial({
    color: colour, dashSize: dash, gapSize: dash * 0.55, transparent: true, depthWrite: false, toneMapped: false,
  }))
  lines.computeLineDistances()
  lines.userData.isVolumeOutline = true
  lines.raycast = () => {}
  return lines
}

export function disposeVolumeOutline(lines: VolumeOutline) {
  lines.removeFromParent()
  lines.geometry.dispose()
  lines.material.dispose()
}

const individual = new WeakMap<THREE.Mesh, {source: THREE.BufferGeometry; lines: VolumeOutline}>()
export function removeMeshOutline(mesh: THREE.Mesh) {
  const record = individual.get(mesh)
  if (!record) return
  disposeVolumeOutline(record.lines)
  individual.delete(mesh)
}

export function setMeshOutline(mesh: THREE.Mesh, enabled: boolean, source: THREE.MeshStandardMaterial, colour: THREE.Color) {
  let record = individual.get(mesh)
  if (!enabled) {
    if (record) removeMeshOutline(mesh)
    return
  }
  if (!record || record.source !== mesh.geometry) {
    if (record) removeMeshOutline(mesh)
    record = {source: mesh.geometry, lines: makeVolumeOutline(mesh.geometry, colour)}
    individual.set(mesh, record)
    mesh.add(record.lines)
  }
  const lineMaterial = record.lines.material
  lineMaterial.color.copy(colour)
  record.lines.onBeforeRender = () => {
    lineMaterial.opacity = source.opacity
    lineMaterial.clippingPlanes = source.clippingPlanes
  }
}
