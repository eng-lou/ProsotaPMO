import * as THREE from 'three'
import { equipmentNodes, followerNodes, jointNodes, validateEquipment, type EquipmentDefinition, type Vec3 } from './equipmentRig'

/** Match an unchanged parts hierarchy beneath an import wrapper. Never guess
 * individual parts by name: duplicate machines and missing groups must fail. */
export function importEquipmentPreset(definition: EquipmentDefinition, root: THREE.Object3D) {
  validateEquipment(definition)
  const def = structuredClone(definition)
  def.controls.forEach(c => { c.keys = []; c.value = c.rest })
  delete def.soil
  const nodes = equipmentNodes(root)
  const paths = [...new Set([
    ...def.joints.flatMap(jointNodes),
    ...def.followers.flatMap(f => [...followerNodes(f), f.base_node, f.tip_node]),
    ...(def.motion_details ?? []).map(d => d.node),
  ].filter(Boolean))]
  if (paths.every(p => nodes.has(p))) { validateEquipment(def, nodes); return def }

  const first = paths[0]
  const candidates = [...nodes.keys()].filter(p => p.endsWith(first))
    .map(p => p.slice(0, p.length - first.length))
    .filter(p => p && nodes.has(p) && paths.every(k => nodes.has(p + k)))
  if (!candidates.length) { validateEquipment(def, nodes); throw new Error('No matching parts hierarchy') }
  if (candidates.length !== 1) throw new Error('Several matching machines were found. Select one machine before importing its rig settings')
  const prefix = candidates[0]
  const chain: THREE.Object3D[] = []
  for (let n = nodes.get(prefix)!; n !== root; n = n.parent!) chain.unshift(n)
  const matrix = new THREE.Matrix4()
  for (const n of chain) { if (n.matrixAutoUpdate) n.updateMatrix(); matrix.multiply(n.matrix) }
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3()
  matrix.decompose(position, rotation, scale)
  const rebuilt = new THREE.Matrix4().compose(position, rotation, scale)
  if (Math.min(scale.x, scale.y, scale.z) <= 1e-8 || Math.max(scale.x, scale.y, scale.z) - Math.min(scale.x, scale.y, scale.z) > 1e-6 * scale.x ||
      matrix.elements.some((v, i) => Math.abs(v - rebuilt.elements[i]) > 1e-6 * Math.max(1, Math.abs(v)))) {
    throw new Error('The import wrapper is stretched, mirrored or sheared. Apply a uniform model scale before reusing this preset')
  }
  for (const j of def.joints) {
    j.node = prefix + j.node
    if (j.members) j.members = j.members.map(p => prefix + p)
    j.pivot = new THREE.Vector3(...j.pivot).applyMatrix4(matrix).toArray() as Vec3
    j.axis = new THREE.Vector3(...j.axis).applyQuaternion(rotation).normalize().toArray() as Vec3
    if (j.pivot_rotation) {
      const q = rotation.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...j.pivot_rotation)))
      const e = new THREE.Euler().setFromQuaternion(q); j.pivot_rotation = [e.x, e.y, e.z]
    }
    if (j.kind === 'slide') { j.minimum *= scale.x; j.maximum *= scale.x }
  }
  for (const f of def.followers) {
    f.barrel = prefix + f.barrel
    if (f.piston) f.piston = prefix + f.piston
    // An attachment at the old root now refers to the matched inner root.
    f.base_node = prefix + f.base_node; f.tip_node = prefix + f.tip_node
  }
  for (const d of def.motion_details ?? []) {
    d.node = prefix + d.node
    if (def.joints.find(j => j.id === d.joint)?.kind === 'slide') d.threshold *= scale.x
  }
  validateEquipment(def, nodes)
  return def
}
