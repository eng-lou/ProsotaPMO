import * as THREE from 'three'
import { TransformControls } from 'three-stdlib'
import wall from '../../../desktop/tests/fixtures/wall.ifc?raw'
import { disposeIfcModel, loadIfcModel, resolveUnloadedId } from '../../src/modules/fourD/ifcModel'
import { regenerateSplitTargets, splitExclusions, syncLevelPieces } from '../../src/modules/fourD/elementSplitTargets'
import { buildSplitElementRef, getSplitExpressId } from '../../src/modules/fourD/splitElementRefs'
import { finalizeIndividualMesh, getElementTransformTarget, getExpressIdWorldBounds, getMeshIndex, hasGeometry, removeElementsFromModel } from '../../src/modules/fourD/elementBatching'
import { enableVisibleViewportRaycast } from '../../src/modules/fourD/viewportRaycast'
import { restoreIfcPlacements } from '../../src/modules/fourD/savedModelPlacement'
import type { ElementSplit } from '../../src/modules/fourD/elementSplits'
import type { ElementTransform } from '../../src/modules/fourD/elementTransforms'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

export async function run() {
  const file = new File([wall], 'Wall.ifc')
  const guid = '0000000000000000000001'
  const first = await loadIfcModel(file)
  const open = [first]
  const canvas = document.createElement('canvas')
  const gizmo = new TransformControls(new THREE.PerspectiveCamera(), canvas)
  try {
    const bounds = getExpressIdWorldBounds(first.object, 10)!
    const mid = bounds.getCenter(new THREE.Vector3())
    const cuts = [mid.y - 0.5, mid.y + 0.5]
    const rows = [{ source_kind: 'ifc', element_ref: guid, cut_elevations_m: cuts }] as ElementSplit[]
    await regenerateSplitTargets(first, rows, 'y')
    const refs = [0, 1, 2].map(i => buildSplitElementRef(guid, i))
    const ids = refs.map(ref => getSplitExpressId(first, ref)!)
    const ray = new THREE.Raycaster()
    enableVisibleViewportRaycast(ray)
    const pick = (x: number, y: number) => {
      first.object.updateMatrixWorld(true)
      ray.set(new THREE.Vector3(x,y,bounds.max.z + 10), new THREE.Vector3(0,0,-1))
      return ray.intersectObject(first.object, true)[0]?.object.userData.expressID
    }
    for (const [i, y] of [mid.y-1,mid.y,mid.y+1].entries()) {
      check(pick(mid.x,y) === ids[i], 'Ray picked the wrong slice '+i)
      const slice = getExpressIdWorldBounds(first.object, ids[i])!
      check(Math.abs(slice.getSize(new THREE.Vector3()).y - 1) < 1e-4, 'Frame selection included another floor')
    }
    const target = getElementTransformTarget(first.object, ids[1])!
    gizmo.attach(target)
    check(gizmo.object === target && Math.abs(target.position.y - mid.y) < 1e-4, 'Missing or off-centre gizmo')
    target.position.x += 5
    const saved = { element_ref: refs[1], position_x: target.position.x, position_y: target.position.y, position_z: target.position.z,
      rotation_x: 0, rotation_y: 0, rotation_z: 0, scale_x: 1, scale_y: 1, scale_z: 1,
      pivot_x:null,pivot_y:null,pivot_z:null,pivot_rotation_x:null,pivot_rotation_y:null,pivot_rotation_z:null } as ElementTransform
    check(pick(mid.x+5,mid.y) === ids[1] && pick(mid.x,mid.y) === undefined, 'Moved slice still picks in its old position')
    check(pick(mid.x,mid.y+1) === ids[2], 'Sibling moved')
    splitExclusions(first).add(refs[0])
    removeElementsFromModel(first.object,[ids[0]])
    await regenerateSplitTargets(first,[...rows],'y')
    check(!hasGeometry(first.object, ids[0]) && pick(mid.x,mid.y-1) === undefined,'Unloaded slice reappeared')
    check(getElementTransformTarget(first.object,ids[1]) === target,'Refresh detached the gizmo')
    const next = await loadIfcModel(file)
    open.push(next)
    splitExclusions(next).add(refs[0])
    await regenerateSplitTargets(next,rows,'y')
    restoreIfcPlacements(next.object,[saved], ref => resolveUnloadedId(next,ref))
    const lowId=resolveUnloadedId(next,refs[0])!, movedId=resolveUnloadedId(next,refs[1])!
    check(!hasGeometry(next.object,lowId) && getElementTransformTarget(next.object,movedId)?.position.x === target.position.x,'Reopen lost a slice edit')
    splitExclusions(next).delete(refs[0])
    await regenerateSplitTargets(next,rows,'y')
    check(hasGeometry(next.object,lowId),'Reload IFC did not restore the selected slice')
    await regenerateSplitTargets(next,[],'y')
    check(!hasGeometry(next.object,movedId) && getMeshIndex(next.object).get(10)?.every(mesh => mesh.visible),'Unsplit left a ghost or lost the source wall')
    // Import a compound wall with a gap. Exercise a rotated root, mirrored
    // representation, Z-up cuts, and a cut change on an unrelated product.
    const root = new THREE.Group()
    root.rotation.z = Math.PI / 2
    root.position.z = 12
    const model = { object: root } as typeof first
    for (const x of [-2,2]) {
      const matrix = new THREE.Matrix4().makeScale(x < 0 ? -1 : 1,1,1).setPosition(x,0,0)
      finalizeIndividualMesh(new THREE.Mesh(new THREE.BoxGeometry(1,0.5,6),new THREE.MeshStandardMaterial({side:THREE.DoubleSide})),12,matrix,root)
    }
    const panel = [{...rows[0], element_ref:'compound',cut_elevations_m:[11,13]}]
    syncLevelPieces(model,panel,'z',1,() => 12)
    const band = getSplitExpressId(model,'compound::split:1')!
    const multi = getElementTransformTarget(root,band)!
    gizmo.attach(multi)
    check(getMeshIndex(root).get(band)?.length === 2 && multi instanceof THREE.Group,'Compound gizmo must own both pieces')
    function hit(y: number) {
      root.updateMatrixWorld(true)
      ray.set(new THREE.Vector3(10,y,12),new THREE.Vector3(-1,0,0))
      return ray.intersectObject(root,true)[0]?.object.userData.expressID
    }
    check(hit(0) === undefined && hit(-2) === band && hit(2) === band,'Opening or mirrored face picked incorrectly')
    multi.position.z += 4
    root.updateMatrixWorld(true)
    const moved = getExpressIdWorldBounds(root,band)!
    check(Math.abs(moved.min.z-15)<1e-5 && Math.abs(moved.max.z-17)<1e-5,'Z-up compound edit lost its bounds')
    syncLevelPieces(model,[{...rows[0],element_ref:'unrelated'},...panel],'z',1,ref => ref==='compound'?12:undefined)
    check(getElementTransformTarget(root,band)===multi,'Refreshing other splits replaced an edited group')
    syncLevelPieces(model,[],'z',1,() => 12)
    return { passed:true, checks:['pick three visible wall slices','slice bounds and pivot','gizmo target and movement','independent unload','restore saved move and exclusion on reopen','selective reload','unsplit','Z-up multi-piece wall with opening and mirrored geometry'] }
  } finally {
    gizmo.dispose()
    open.forEach(disposeIfcModel)
  }
}
