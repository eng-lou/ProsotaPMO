import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const result = await build({stdin:{resolveDir:process.cwd(),contents:`
export * as T from 'three'
export * from './src/modules/fourD/planningCopies'
export * from './src/modules/fourD/groupMove'
export * from './src/modules/fourD/materialScope'
`},bundle:true,write:false,format:'esm'})
const {T,groupCentre,beginGroupMove,translateGroup,ifcCopySource,planningSnapshot,copySitePlacements,copySiteMaterialMappings} =
  await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
const near = (actual,expected) => assert.ok(actual.distanceTo(expected)<1e-5,actual.toArray()+' vs '+expected.toArray())

test('a seven-part selection moves together under different parent frames, using the geometry centre', () => {
  const scene = new T.Group()
  const targets = Array.from({length:7}, (_,i) => {
    const parent=new T.Group(), object=new T.Group()
    parent.rotation.z=i/7; parent.scale.set(1+i,2,1); scene.add(parent);parent.add(object)
    const mesh=new T.Mesh(new T.BoxGeometry(2,3,4))
    mesh.position.set(i*10+40,11,20);object.add(mesh)
    return {id:String(i),object}
  })
  scene.updateMatrixWorld(true)
  const initial=new T.Box3().setFromObject(scene)
  near(groupCentre(targets),initial.getCenter(new T.Vector3()))
  const positions=targets.map(t=>t.object.getWorldPosition(new T.Vector3()))
  const move=beginGroupMove(targets)
  for(const delta of [new T.Vector3(5,-2,7),new T.Vector3(3,11,-5),new T.Vector3()]){
    translateGroup(move,delta)
    targets.forEach(({object},i)=>near(object.getWorldPosition(new T.Vector3()),positions[i].clone().add(delta)))
  }
})

test('copy a multipart IFC product in either world up axis at the same position, excluding adjacent geometry', () => {
  const model=new T.Group();model.position.set(8,3,-7);model.rotation.y=.8
  const pieces=[0,2,100].map(x=>{const mesh=new T.Mesh(new T.BoxGeometry(1,1,2),new T.MeshStandardMaterial());mesh.position.x=x;model.add(mesh);return mesh})
  model.userData.expressIdMeshIndex=new Map([[52,pieces.slice(0,2)],[54,[pieces[2]]]])
  const selection=ifcCopySource(model,52)
  const expected=new T.Box3().setFromObject(selection,true)
  for(const up of ['y','z']){
    const {root,position}=planningSnapshot(selection,up,'Wall')
    assert.equal(root.children.length,2)
    const placement=new T.Group();placement.add(root);placement.position.set(position.x,position.y,position.z)
    if(up==='z')root.rotation.x=Math.PI/2
    const actual=new T.Box3().setFromObject(placement,true)
    near(actual.min,expected.min);near(actual.max,expected.max)
    assert.ok(root.children[0].geometry!==pieces[0].geometry)
  }
  assert.throws(()=>ifcCopySource(model,99),/no loaded geometry/)
  assert.equal(pieces[0].parent,model)
})

test('new placement identities preserve asset parts, rekey assemblies and paired attachments, and isolate materials', () => {
  const original={id:'src',name:'Gate',assembly_id:'assembly',asset_id:'a',asset_part:{path:[0,1]},activity_id:'task',operation_inputs:['file:source'],locked:true,section_boxes:[{id:'box'}],path_motion:{path_id:'route'}}
  const tool={...original,id:'tool',attachment:{parent_id:'src'}}
  const [copy,attached]=copySitePlacements([original,tool])
  assert.notEqual(copy.id,original.id);assert.deepEqual(copy.asset_part,original.asset_part);assert.equal(copy.asset_id,'a')
  assert.equal(copy.activity_id,null);assert.equal(copy.locked,false);assert.equal(copy.path_motion,null)
  assert.deepEqual(copy.operation_inputs,[]);assert.notEqual(copy.section_boxes[0].id,'box')
  assert.equal(copy.assembly_id,attached.assembly_id);assert.notEqual(copy.assembly_id,'assembly');assert.equal(attached.attachment.parent_id,copy.id)
  copy.asset_part.path.push(3);assert.deepEqual(original.asset_part.path,[0,1])
  const mapping={'@site%3Asrc/site-shape|src|surface':'lawn','@site%3Asrc/@instance%3A0/site-geo|src|roof':'red','site-shape|src|trunk':'brown','other':'soil'}
  const updated=copySiteMaterialMappings(mapping,new Map([['src','dst']]))
  assert.equal(updated['@site%3Adst/site-shape|dst|surface'],'lawn')
  assert.equal(updated['@site%3Adst/@instance%3A0/site-geo|dst|roof'],'red')
  assert.equal(updated['site-shape|dst|trunk'],'brown');assert.equal(Object.keys(mapping).length,4)
})
