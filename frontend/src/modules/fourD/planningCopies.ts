import { Box3, Group, Mesh, Vector3, type Object3D } from 'three'
import type { SiteItem } from './siteScene'
import { getMaterializedMeshes } from './elementBatching'
import { arraySourceSnapshot, disposeArraySnapshot } from './arraySourceSnapshot'

export const copyName = (name: string) => name.slice(0, 95) + ' copy'

export function copySitePlacements(items: SiteItem[]) {
  const ids = new Map(items.map(item => [item.id, crypto.randomUUID()]))
  const assemblies = new Map<string, string>()
  return items.map(source => {
    const copy = structuredClone(source)
    copy.id = ids.get(source.id)!
    copy.name = copyName(source.name)
    copy.locked = false
    copy.activity_id = null
    copy.operation_inputs = []
    // A planning copy starts free to position, even if its source travels on a route.
    copy.path_motion = null
    copy.motion_actions = []
    if (copy.attachment && ids.has(copy.attachment.parent_id)) copy.attachment.parent_id = ids.get(copy.attachment.parent_id)!
    else copy.attachment = null
    if (copy.assembly_id) {
      if (!assemblies.has(copy.assembly_id)) assemblies.set(copy.assembly_id, crypto.randomUUID())
      copy.assembly_id = assemblies.get(copy.assembly_id)
    }
    for (const box of copy.section_boxes ?? []) box.id = crypto.randomUUID()
    return copy
  })
}

/** Capture every piece of just this product, including its current world placement. */
export function ifcCopySource(root: Object3D, expressId: number) {
  const meshes = getMaterializedMeshes(root, expressId)
  if (!meshes?.length) throw Error('IFC element ' + expressId + ' has no loaded geometry to copy.')
  const group = new Group()
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    const piece = new Mesh(mesh.geometry, mesh.material)
    piece.name = mesh.name
    piece.userData.standardMaterial = mesh.userData.standardMaterial
    piece.matrixAutoUpdate = false
    piece.matrix.copy(mesh.matrixWorld)
    group.add(piece)
  }
  return group
}

export function planningSnapshot(source: Object3D, up: 'y' | 'z', name: string) {
  const root = arraySourceSnapshot(source, up, name, false)
  const bounds = new Box3().setFromObject(root)
  const anchor = bounds.getCenter(new Vector3())
  anchor.y = bounds.min.y
  for (const piece of root.children) (piece as Mesh).geometry.translate(-anchor.x, -anchor.y, -anchor.z)
  const position = up === 'y' ? {x:anchor.x,y:anchor.y,z:anchor.z} : {x:anchor.x,y:-anchor.z,z:anchor.y}
  return { root, position }
}

export async function planningCopyFile(source: Object3D, up: 'y' | 'z', name: string) {
  const { root, position } = planningSnapshot(source, up, name)
  try {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
    const bytes = await new GLTFExporter().parseAsync(root, { binary: true }) as ArrayBuffer
    const file = new File([bytes], name.replace(/[^\w .-]/g, '_') + '.glb', { type:'model/gltf-binary' })
    return { file, position }
  } finally { disposeArraySnapshot(root) }
}
