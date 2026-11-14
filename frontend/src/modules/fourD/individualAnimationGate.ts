import type { Material, Mesh, Object3D } from 'three'

type Target = { object: Object3D; materials: { mesh: Mesh; material: Material }[]; cachedState?: unknown }
type MaterialState = { material: Material; version: number; opacity: number; visible: boolean; transparent: boolean; depthWrite: boolean; planes: Material['clippingPlanes'] }
function captureMaterial(material: Material): MaterialState {
  return { material, version: material.version, opacity: material.opacity, visible: material.visible,
    transparent: material.transparent, depthWrite: material.depthWrite, planes: material.clippingPlanes }
}
function changed(s: MaterialState) {
  const m = s.material
  return m.version !== s.version || m.opacity !== s.opacity || m.visible !== s.visible
    || m.transparent !== s.transparent || m.depthWrite !== s.depthWrite || m.clippingPlanes !== s.planes
}

// React commits invalidate authored changes (colours, transforms, profiles,
// selection, render mode). Between commits only inspect the render state that
// imperative visibility/animation writers can replace. Do not rebuild clipping
// planes, tint colours or synchronize variants for a stationary timeline.
export function createIndividualAnimationGate<T extends Target>() {
  let revision = 0
  type Snapshot = { revision: number; state: unknown; materials: T['materials']; controlled: unknown;
    px: number; py: number; pz: number; rx: number; ry: number; rz: number; order: string; sx: number; sy: number; sz: number;
    entries: { mesh: Mesh; visible: boolean; baseVisible: unknown; display: Mesh['material']; slots: Material[] | null; source: Material;
      lambert: Material | undefined; hiddenLine: Material | undefined; realistic: Material | undefined;
      edge: Object3D | undefined; edgeMaterial: Material | undefined; states: MaterialState[] }[] }
  const snapshots = new WeakMap<T, Snapshot>()
  return {
    invalidate() { revision++ },
    needsUpdate(target: T, dateChanged: boolean) {
      if (dateChanged) return true
      const s = snapshots.get(target)
      if (!s || s.revision !== revision || s.state !== target.cachedState || s.materials !== target.materials
        || s.entries.length !== target.materials.length || s.controlled !== target.object.userData.simulatorOwnsPose) return true
      const { position: p, rotation: r, scale: z } = target.object
      if (p.x !== s.px || p.y !== s.py || p.z !== s.pz || r.x !== s.rx || r.y !== s.ry || r.z !== s.rz
        || r.order !== s.order || z.x !== s.sx || z.y !== s.sy || z.z !== s.sz) return true
      for (let i = 0; i < s.entries.length; i++) {
        const e = s.entries[i], entry = target.materials[i], data = entry.material.userData, edge = e.mesh.userData.edgesHelper
        if (entry.mesh !== e.mesh || entry.material !== e.source || e.mesh.visible !== e.visible || e.mesh.userData.baseVisible !== e.baseVisible
          || e.mesh.material !== e.display || data.lambertVariant !== e.lambert || data.hiddenLineVariant !== e.hiddenLine
          || data.realisticVariant !== e.realistic || edge !== e.edge || edge?.material !== e.edgeMaterial) return true
        if (e.slots && Array.isArray(e.mesh.material)) {
          if (e.slots.length !== e.mesh.material.length) return true
          for (let slot = 0; slot < e.slots.length; slot++) if (e.slots[slot] !== e.mesh.material[slot]) return true
        }
        for (const state of e.states) if (changed(state)) return true
      }
      return false
    },
    applied(target: T) {
      const entries = target.materials.map(({mesh, material: source}) => {
        const {lambertVariant: lambert, hiddenLineVariant: hiddenLine, realisticVariant: realistic} = source.userData
        const edge = mesh.userData.edgesHelper, edgeMaterial = edge?.material
        const display = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const materials = new Set<Material>([source, ...display, lambert, hiddenLine, realistic, edgeMaterial].filter(Boolean))
        return { mesh, visible: mesh.visible, baseVisible: mesh.userData.baseVisible, display: mesh.material,
          slots: Array.isArray(mesh.material) ? [...mesh.material] : null, source,
          lambert, hiddenLine, realistic, edge, edgeMaterial, states: [...materials].map(captureMaterial) }
      })
      const { position: p, rotation: r, scale: z } = target.object
      snapshots.set(target, { revision, state: target.cachedState, materials: target.materials,
        px: p.x, py: p.y, pz: p.z, rx: r.x, ry: r.y, rz: r.z, order: r.order, sx: z.x, sy: z.y, sz: z.z,
        controlled: target.object.userData.simulatorOwnsPose, entries })
    },
  }
}
