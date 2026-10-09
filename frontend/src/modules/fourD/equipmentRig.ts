import * as THREE from 'three'

export type Vec3 = [number, number, number]
export interface EquipmentKey { date: string; value: number; interpolation: 'linear' | 'smooth' | 'hold' }
export interface EquipmentControl { id: string; name: string; value: number; rest: number; keys: EquipmentKey[] }
export interface EquipmentJoint {
  id: string; name: string; node: string; members?: string[]; parent: string | null; control: string
  kind: 'hinge' | 'slide'; pivot: Vec3; axis: Vec3; minimum: number; maximum: number; response: [number, number][]
}
export interface EquipmentFollower { id: string; name: string; barrel: string; piston: string; base_node: string; tip_node: string; base_point: Vec3; tip_point: Vec3 }
export interface EquipmentDefinition { schema_version: 1; controls: EquipmentControl[]; joints: EquipmentJoint[]; followers: EquipmentFollower[] }
export interface EquipmentRig { id: string; project_id: string; model_ref: string; name: string; version: number; definition: EquipmentDefinition }
export const emptyEquipment = (): EquipmentDefinition => ({ schema_version: 1, controls: [], joints: [], followers: [] })

// Structural paths with names survive reloads, and fail closed after model hierarchy changes.
// Runtime UUIDs are deliberately excluded. No scene reparenting changes these paths.
export function equipmentNodes(root: THREE.Object3D) {
  const result = new Map<string, THREE.Object3D>([['', root]])
  function visit(node: THREE.Object3D, path: string) {
    node.children.forEach((child, index) => {
      const key = `${path}/${index}:${encodeURIComponent(child.name)}`
      result.set(key, child); visit(child, key)
    })
  }
  visit(root, '')
  return result
}

export function controlValue(control: EquipmentControl, time: number | null): number {
  const keys = [...control.keys].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  if (time === null || !keys.length) return control.value
  if (time <= Date.parse(keys[0].date)) return keys[0].value
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i]
    if (time <= Date.parse(b.date)) {
      let t = (time - Date.parse(a.date)) / (Date.parse(b.date) - Date.parse(a.date))
      if (a.interpolation === 'hold') t = time === Date.parse(b.date) ? 1 : 0
      if (a.interpolation === 'smooth') t = t * t * (3 - 2 * t)
      return a.value + (b.value - a.value) * t
    }
  }
  return keys[keys.length - 1].value
}

function responseAt(points: [number, number][], value: number) {
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i]
    if (value <= x1) return y0 + (y1 - y0) * (value - x0) / (x1 - x0)
  }
  return points[points.length - 1][1]
}

export const jointNodes = (j: EquipmentJoint) => [j.node, ...(j.members ?? [])]

export function validateEquipment(def: EquipmentDefinition, nodes?: Map<string, THREE.Object3D>) {
  if (def.schema_version !== 1 || !Array.isArray(def.controls) || !Array.isArray(def.joints) || !Array.isArray(def.followers)) throw new Error('Unsupported equipment preset')
  if (def.controls.length > 100 || def.joints.length > 200 || def.followers.length > 100) throw new Error('Equipment definition is too large')
  if (def.controls.reduce((sum, c) => sum + (c.keys?.length ?? 0), 0) > 20000) throw new Error('Equipment rig exceeds 20,000 keyframes')
  for (const items of [def.controls, def.joints, def.followers]) {
    if (new Set(items.map(x => x.id)).size !== items.length) throw new Error('Duplicate equipment IDs')
    if (items.some(x => !x.id || !x.name?.trim())) throw new Error('Every control and mechanism needs a name')
  }
  const finite = (v: number) => typeof v === 'number' && Number.isFinite(v)
  const vector = (v: Vec3) => Array.isArray(v) && v.length === 3 && v.every(finite)
  const unit = (v: number) => finite(v) && v >= 0 && v <= 1
  for (const c of def.controls) {
    if (!unit(c.value) || !unit(c.rest) || !Array.isArray(c.keys) || c.keys.length > 10000) throw new Error('Control values must be between 0 and 1')
    if (new Set(c.keys.map(k => Date.parse(k.date))).size !== c.keys.length) throw new Error('Duplicate keyframe time')
    if (c.keys.some(k => !Number.isFinite(Date.parse(k.date)) || !unit(k.value) || !['linear', 'smooth', 'hold'].includes(k.interpolation))) throw new Error('Invalid control keyframe')
  }
  const drivers = [...def.joints.flatMap(jointNodes), ...def.followers.flatMap(f => [f.barrel, f.piston])]
  if (new Set(drivers).size !== drivers.length || drivers.some(n => !n)) throw new Error('Each part needs one driver; leave the equipment root for paths/transforms')
  const requireNode = (node: string) => { if (nodes && !nodes.has(node)) throw new Error(`Part missing from model: ${node}`) }
  drivers.forEach(requireNode)
  const jointMap = new Map(def.joints.map(j => [j.id, j]))
  for (const j of def.joints) {
    if (j.members && (!Array.isArray(j.members) || j.members.length > 500 || j.members.some(n => typeof n !== 'string' || !n || n.length > 2000))) throw new Error('Invalid group parts')
    if (jointNodes(j).some(n => jointNodes(j).some(a => n !== a && n.startsWith(a + '/')))) throw new Error('Select a part or its children, not both')
    if (!def.controls.some(c => c.id === j.control)) throw new Error(`Choose a control for ${j.name}`)
    if (!vector(j.axis) || Math.hypot(...j.axis) < 1e-6 || !vector(j.pivot) || !finite(j.minimum) || !finite(j.maximum) || !['hinge', 'slide'].includes(j.kind)) throw new Error(`Invalid joint settings: ${j.name}`)
    if (!Array.isArray(j.response) || j.response.length < 2 || j.response[0][0] !== 0 || j.response[j.response.length - 1][0] !== 1 || j.response.some((p, i) => !unit(p[0]) || !unit(p[1]) || (i > 0 && p[0] <= j.response[i - 1][0]))) throw new Error(`Invalid response curve: ${j.name}`)
    const seen = new Set([j.id]); let parent = j.parent
    while (parent) {
      if (seen.has(parent)) throw new Error('Joint hierarchy contains a cycle')
      seen.add(parent)
      const p = jointMap.get(parent); if (!p) throw new Error('Unknown parent joint')
      parent = p.parent
    }
    // A driven ancestor must be in the mechanical chain, otherwise it would have
    // ambiguous ownership of the child's transform. Sibling meshes are supported.
    for (const a of def.joints) if (jointNodes(j).some(n => jointNodes(a).some(p => n.startsWith(p + '/'))) && !seen.has(a.id)) throw new Error(`${j.name} must inherit from its driven ancestor ${a.name}`)
  }
  const followerNodes = def.followers.flatMap(f => [f.barrel, f.piston])
  for (const f of def.followers) {
    requireNode(f.base_node); requireNode(f.tip_node)
    if (!vector(f.base_point) || !vector(f.tip_point)) throw new Error('Invalid cylinder attachment points')
    if ([f.base_node, f.tip_node].some(n => followerNodes.some(a => n === a || n.startsWith(a + '/'))) || drivers.some(n => followerNodes.some(a => n !== a && n.startsWith(a + '/')))) throw new Error('Followers cannot drive other mechanisms or their attachment points')
  }
}

/** Bind once to unanimated rest geometry. Evaluation is absolute, never incremental. */
export function bindEquipment(root: THREE.Object3D, definition: EquipmentDefinition) {
  const nodes = equipmentNodes(root)
  validateEquipment(definition, nodes)
  const locals = new Map<string, THREE.Matrix4>(), rest = new Map<string, THREE.Matrix4>()
  // Root may be hidden by a zero-scale schedule animation when the rig loads.
  root.updateWorldMatrix(true, true)
  for (const [key, node] of nodes) {
    locals.set(key, node.matrix.clone())
    const parentKey = key.slice(0, key.lastIndexOf('/'))
    rest.set(key, key ? rest.get(parentKey)!.clone().multiply(node.matrix) : new THREE.Matrix4())
    if ((node as THREE.SkinnedMesh).isSkinnedMesh || (node as THREE.InstancedMesh).isInstancedMesh) throw new Error('Equipment controls require separate rigid mesh parts')
  }
  const applyMatrix = (node: THREE.Object3D, matrix: THREE.Matrix4) => {
    matrix.decompose(node.position, node.quaternion, node.scale); node.updateMatrix()
  }
  const driven = new Set([...definition.joints.flatMap(jointNodes), ...definition.followers.flatMap(f => [f.barrel, f.piston])])
  const controls = new Map(definition.controls.map(c => [c.id, c]))
  const byId = new Map(definition.joints.map(j => [j.id, j]))
  const restore = () => { for (const key of driven) applyMatrix(nodes.get(key)!, locals.get(key)!) }
  const worldPoint = (key: string, point: Vec3, matrices: Map<string, THREE.Matrix4>) => new THREE.Vector3(...point).applyMatrix4(matrices.get(key)!)
  for (const f of definition.followers) if (worldPoint(f.base_node, f.base_point, rest).distanceTo(worldPoint(f.tip_node, f.tip_point, rest)) < 1e-8) throw new Error(`Cylinder ${f.name} needs two distinct attachment points`)
  return {
    restore,
    evaluate(time: number | null, overrides: Record<string, number> = {}, poses: Record<string, number> = {}) {
      restore()
      const deltas = new Map<string, THREE.Matrix4>()
      const values = new Map(definition.controls.map(c => [c.id, overrides[c.id] ?? controlValue(c, time)]))
      function delta(j: EquipmentJoint): THREE.Matrix4 {
        if (deltas.has(j.id)) return deltas.get(j.id)!
        const c = controls.get(j.control)!
        const value = values.get(c.id)!
        const amount = poses[j.id] ?? (j.maximum - j.minimum) * (responseAt(j.response, value) - responseAt(j.response, c.rest))
        const axis = new THREE.Vector3(...j.axis).normalize()
        const own = j.kind === 'slide'
          ? new THREE.Matrix4().makeTranslation(...axis.multiplyScalar(amount).toArray() as Vec3)
          : new THREE.Matrix4().makeTranslation(...j.pivot).multiply(new THREE.Matrix4().makeRotationAxis(axis, THREE.MathUtils.degToRad(amount))).multiply(new THREE.Matrix4().makeTranslation(-j.pivot[0], -j.pivot[1], -j.pivot[2]))
        const result = j.parent ? delta(byId.get(j.parent)!).clone().multiply(own) : own
        deltas.set(j.id, result); return result
      }
      const desired = new Map<string, THREE.Matrix4>()
      for (const j of definition.joints) for (const node of jointNodes(j)) desired.set(node, delta(j).clone().multiply(rest.get(node)!))
      // Node paths are parent-first. Propagate inherited transforms for un-driven nodes.
      const matrices = new Map<string, THREE.Matrix4>([['', new THREE.Matrix4()]])
      for (const [key] of nodes) {
        if (!key) continue
        const parentKey = key.slice(0, key.lastIndexOf('/'))
        matrices.set(key, desired.get(key) ?? matrices.get(parentKey)!.clone().multiply(locals.get(key)!))
      }
      for (const f of definition.followers) {
        const a0 = worldPoint(f.base_node, f.base_point, rest), b0 = worldPoint(f.tip_node, f.tip_point, rest)
        const a = worldPoint(f.base_node, f.base_point, matrices), b = worldPoint(f.tip_node, f.tip_point, matrices)
        if (a.distanceToSquared(b) < 1e-16) continue
        const q = new THREE.Quaternion().setFromUnitVectors(b0.clone().sub(a0).normalize(), b.clone().sub(a).normalize())
        for (const [key, from, to] of [[f.barrel, a0, a], [f.piston, b0, b]] as [string, THREE.Vector3, THREE.Vector3][]) {
          desired.set(key, new THREE.Matrix4().makeTranslation(to.x, to.y, to.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(new THREE.Matrix4().makeTranslation(-from.x, -from.y, -from.z)).multiply(rest.get(key)!))
        }
      }
      for (const [key, node] of nodes) {
        if (!key) continue
        const parentKey = key.slice(0, key.lastIndexOf('/'))
        const parent = matrices.get(parentKey)!
        if (desired.has(key)) {
          const target = desired.get(key)!
          applyMatrix(node, parent.clone().invert().multiply(target)); matrices.set(key, target)
        } else matrices.set(key, parent.clone().multiply(locals.get(key)!))
      }
      root.updateWorldMatrix(true, true)
    },
  }
}
