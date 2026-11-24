import { Box3, BoxGeometry, Group, Mesh, Vector3 } from 'three'
import { checkSolid, computeShapeBoolean, disposeBooleanResults, OpenSolidError, type BooleanResult } from './shapeBoolean'
import { arraySourceSnapshot, disposeArraySnapshot } from './arraySourceSnapshot'
import { splitSlabProfile } from './slabPourProfile'
import type { ConstructionPreview, HostSource } from './constructionLayout'
import type { Path } from './paths'

function cutSlab(slab: Group, cutter: Mesh, normal: Vector3, offset: number) {
  let pieces: BooleanResult[] = []
  try {
    pieces = computeShapeBoolean(slab,cutter,'y','excavate',true)
    if (pieces.length !== 2) throw Error('Extend the break through the slab interior.')
    for (const piece of pieces) checkSolid(piece.mesh.geometry)
    const removed = pieces[1].mesh
    disposeMaterials(removed)
    const material = pieces[0].mesh.material
    removed.material = (Array.isArray(material) ? material[0] : material).clone()
    removed.geometry.clearGroups()
    return pieces
  } catch (error) {
    disposeBooleanResults(pieces)
    if (!(error instanceof OpenSolidError)) throw error
    const repaired = splitSlabProfile(slab,normal,offset)
    if (repaired) return repaired
    throw Error('Could not form two closed pour zones. Check the slab for open faces or a mismatch between its top and underside profiles.')
  }
}

export function divideSlab(source: HostSource, path: Path, axis: 'y'|'z'): ConstructionPreview[] {
  if (source.ifcType && !/slab/i.test(source.ifcType)) throw Error('Select a slab.')
  if (path.closed || path.points.length !== 2) throw Error('Draw an open, two-point pour break in Paths.')
  const up = new Vector3(1,0,0), rotation = axis === 'z' ? -Math.PI/2 : 0
  const [a,b] = path.points.map(p => new Vector3(p.x,p.y,p.z).applyAxisAngle(up,rotation))
  const normal = new Vector3(-(b.z-a.z),0,b.x-a.x)
  if (normal.length() < .01) throw Error('The break needs two different points in plan.')
  normal.normalize()
  const slab = arraySourceSnapshot(source.object,axis,'Slab',false)
  const box = new Box3().setFromObject(slab,true), origin = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3()).length()+1
  const offset = normal.dot(a.sub(origin))
  const cutter = new Mesh(new BoxGeometry(size*2,size*2,size*2))
  try {
    slab.children.forEach(n => (n as Mesh).geometry.translate(-origin.x,-origin.y,-origin.z))
    cutter.rotation.y = -Math.atan2(normal.z,normal.x)
    cutter.position.copy(normal).multiplyScalar(offset+size)
    return cutSlab(slab,cutter,normal,offset).map((piece,i) => {
      const scene = new Group()
      scene.add(piece.mesh)
      return {scene,anchor:piece.position.add(origin).applyAxisAngle(up,-rotation),label:source.name.slice(0,86)+' · Pour '+(i?'B':'A'),hosts:1,parts:1,sourceRefs:[source.backupRef??source.id]}
    })
  } finally {
    disposeArraySnapshot(slab)
    cutter.geometry.dispose()
    disposeMaterials(cutter)
  }
}

function disposeMaterials(mesh: Mesh) {
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
}
