import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { outputFiles } = await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('../src/modules/fourD/', import.meta.url)),
    contents: "export * as T from 'three'; export * from './elementBatching'; export * from './savedModelPlacement'; export * from './viewportVisibility'; export * from './linkedElements'; export * from './collectionResolvers'; export {setPivot} from './elementPivot';",
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
})
const { T, finalizeIndividualMesh, getMaterializedMeshes, getElementTransformTarget, removeElementsFromModel,
  resolveElementRefsToTargets, resolveSelectionToMemberRefs, resolveActivityLinksToIsolationTargets, resolveIsolationTargetsToActivityIds, restoreRemovedElements, hasGeometry, updateMeshVisibility, updateInstanceVisibility, restoreIfcPlacements, setPivot } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

function fixture() {
  const root = new T.Group(), geo = new T.BoxGeometry(), mat = new T.MeshStandardMaterial()
  const batchMesh = new T.BatchedMesh(3, 24, 36, mat)
  const geometryId = batchMesh.addGeometry(geo)
  const batch = {mesh: batchMesh, byExpressId: new Map(), expressIdByInstanceId: new Map(), geometryById: new Map([[geometryId, geo]]), geometryByIfcId: new Map([[16, {geometryId, geometry: geo}]])}
  root.userData.batch = batch
  root.add(batchMesh)
  function add(id, matrix) {
    const instanceId = batchMesh.addInstance(geometryId)
    batchMesh.setMatrixAt(instanceId, matrix)
    batch.byExpressId.set(id, [{instanceId, matrix, geometryId, ifcGeometryId: 16, colorAlpha: 1, color: new T.Color('white')}])
    batch.expressIdByInstanceId.set(instanceId, id)
    return instanceId
  }
  const rotation = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.7)
  const base = new T.Matrix4().compose(new T.Vector3(13, -4, 5), rotation, new T.Vector3(-0.001, 0.002, 0.003))
  const mirrored = new T.Mesh(geo.clone(), mat.clone())
  mirrored.userData.ifcGeometryId = 16
  finalizeIndividualMesh(mirrored, 5, base, root)
  const siblingBase = new T.Matrix4().makeTranslation(10, 2, 6)
  const siblingId = add(5, siblingBase), neighbourId = add(6, new T.Matrix4())
  return {root, batch, base, siblingBase, siblingId, neighbourId}
}

function near(a, b) {
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(a.elements[i] - b.elements[i]) < 1e-8, 'matrix component ' + i)
}

test('one IFC edit includes mirrored and batched pieces and preserves the other instance', () => {
  const {root, batch, base, siblingBase, siblingId, neighbourId} = fixture()
  const placement = getElementTransformTarget(root, 5)
  assert.equal(getElementTransformTarget(root, 5), placement)
  const [body, fitting] = getMaterializedMeshes(root, 5)
  assert.equal(batch.mesh.getVisibleAt(siblingId), false)
  assert.equal(batch.mesh.getVisibleAt(neighbourId), true)
  assert.equal(batch.byExpressId.size, 1)
  near(body.matrixWorld, base)
  near(fitting.matrixWorld, siblingBase)
  placement.position.y += 3
  placement.rotateZ(0.4)
  placement.scale.z *= 2
  root.updateMatrixWorld(true)
  const delta = placement.matrix.clone().multiply(base.clone().invert())
  near(body.matrixWorld, delta.clone().multiply(base))
  near(fitting.matrixWorld, delta.clone().multiply(siblingBase))
  removeElementsFromModel(root, [5])
  assert.equal(placement.parent, null)
  assert.equal(getElementTransformTarget(root, 5), null)
})

test('fresh imports restore a saved first-piece pose once across the product, including pivot offsets', () => {
  const {root, base, siblingBase} = fixture()
  const saved = {element_ref: 'cabin', position_x: -8, position_y: 9, position_z: 2,
    rotation_x: 0, rotation_y: 0.7, rotation_z: 0, scale_x: -0.001, scale_y: 0.002, scale_z: 0.003,
    pivot_x: 500, pivot_y: 0, pivot_z: 0, pivot_rotation_x: null, pivot_rotation_y: null, pivot_rotation_z: null}
  restoreIfcPlacements(root, [saved], guid => guid === 'cabin' ? 5 : undefined)
  const placement = getElementTransformTarget(root, 5), [body, fitting] = getMaterializedMeshes(root, 5)
  root.updateMatrixWorld(true)
  const expected = placement.matrix.clone().multiply(new T.Matrix4().makeTranslation(-500, 0, 0)).multiply(base.clone().invert())
  near(body.matrixWorld, expected.clone().multiply(base))
  near(fitting.matrixWorld, expected.clone().multiply(siblingBase))
  const fresh = fixture()
  const target = getElementTransformTarget(fresh.root, 5)
  setPivot(target, new T.Vector3(500, 30, 80))
  fresh.root.updateMatrixWorld(true)
  near(getMaterializedMeshes(fresh.root, 5)[1].matrixWorld, siblingBase)
})

test('selective reload restores mixed IFC geometry without duplicates and validates before changing any part', () => {
  const {root, batch, base, siblingBase} = fixture()
  removeElementsFromModel(root, [5, 6])
  assert.throws(() => restoreRemovedElements(root, [5, 99]), /unavailable/)
  assert.equal(hasGeometry(root, 5), false)
  assert.deepEqual(restoreRemovedElements(root, [5, 5]), [5])
  assert.equal(hasGeometry(root, 6), false)
  assert.equal(batch.byExpressId.get(5).length, 1)
  assert.deepEqual(restoreRemovedElements(root, [5]), [])
  const [body, fitting] = getMaterializedMeshes(root, 5)
  root.updateMatrixWorld(true)
  near(body.matrixWorld, base)
  near(fitting.matrixWorld, siblingBase)
  removeElementsFromModel(root, [5])
  restoreRemovedElements(root, [5, 6])
  assert.equal(getMaterializedMeshes(root, 5).length, 2)
})

test('Hide survives paused playback and hiding during orbit for both IFC representations', () => {
  const {root, batch, neighbourId} = fixture()
  const part = getMaterializedMeshes(root, 5)[0]
  part.userData.baseVisible = false
  updateMeshVisibility(part, true)
  assert.equal(part.visible, false)
  part.userData.baseVisible = true
  updateMeshVisibility(part, false)
  updateMeshVisibility(part)
  assert.equal(part.visible, false)
  updateMeshVisibility(part, true)
  assert.equal(part.visible, true)
  batch.mesh.userData.batchBaseVisibleByInstanceId = new Map([[neighbourId, false]])
  updateInstanceVisibility(batch.mesh, neighbourId, true)
  assert.equal(batch.mesh.getVisibleAt(neighbourId), false)
  batch.mesh.userData.batchBaseVisibleByInstanceId.set(neighbourId, true)
  batch.mesh.userData.movingHidden = new Set([neighbourId])
  updateInstanceVisibility(batch.mesh, neighbourId)
  assert.equal(batch.mesh.getVisibleAt(neighbourId), false)
  batch.mesh.userData.movingHidden.clear()
  updateInstanceVisibility(batch.mesh, neighbourId)
  assert.equal(batch.mesh.getVisibleAt(neighbourId), true)
})

test('collections distinguish same-named site placements and retain the selected result after a rename and reload', async () => {
  const objects = [
    {id: 'legacy', kind: 'mesh', name: 'Gate.glb'},
    {id: 'site:a', kind: 'mesh', name: 'Excavation · result'},
    {id: 'site:b', kind: 'mesh', name: 'Excavation · result'},
  ]
  const chosen = await resolveSelectionToMemberRefs(new Set(['legacy', 'site:b']), new Set(), objects, null)
  assert.deepEqual(chosen.map(ref => ref.element_ref), ['Gate.glb', 'site:b'])
  const reopened = objects.map(o => ({...o, name: o.id === 'site:b' ? 'North excavation' : o.name}))
  const result = await resolveElementRefsToTargets(chosen, reopened, [])
  assert.deepEqual([...result.objectIds], ['legacy', 'site:b'])
  const links = [{source_kind:'site', element_ref:'b', activity_id:'dig'}]
  const linked = await resolveActivityLinksToIsolationTargets(new Set(['dig']), links, reopened, [])
  assert.deepEqual([...linked.objectIds], ['site:b'])
  assert.deepEqual([...await resolveIsolationTargetsToActivityIds(linked.objectIds, new Set(), links, reopened, [])], ['dig'])
})
